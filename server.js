/* ============================================================
   Bingo Bango — the shell
   Owns: rooms, players, identity, avatars, the game picker,
   voting, and the running scoreboard.
   Knows nothing about how any individual mini game works.
   ============================================================ */

const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');

/* ---------- game registry -------------------------------------------------
   To add a mini game: write game-<id>.js and client-<id>.js, then add two
   lines — one here, one in CLIENT_FILES below. Nothing else changes.        */

const GAME_MODULES = [
  require('./game-plotparty.js'),
   require('./game-birdflew.js'),
   require('./game-pointblank.js'),
   
];

const CLIENT_FILES = {
  plotparty: 'client-plotparty.js',
  birdflew: 'client-birdflew.js',
  pointblank': 'client-pointblank.js',
};

const GAMES = {};
GAME_MODULES.forEach(g => { GAMES[g.id] = g; });

const GAME_LIST = GAME_MODULES.map(g => ({
  id: g.id, name: g.name, tagline: g.tagline, minPlayers: g.minPlayers || 1,
}));

/* ---------- constants ----------------------------------------------------- */

const MAX_PLAYERS = 12;
const ROOM_TTL_MS = 1000 * 60 * 60 * 3;   // empty rooms are swept after 3 hours
const VOTE_SECONDS = 20;

const COLOURS = [
  '#FF4D6D', '#C6F135', '#4CC9F0', '#FFB01F', '#B47CFF', '#3DDC97',
  '#FF7A45', '#F5F1E6', '#7A8BFF', '#FF61C7', '#59E3C5', '#FFE066',
];

/* ---------- app ----------------------------------------------------------- */

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 2e6 });

// Render caches aggressively and iPad Safari caches harder. Never let it.
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

// Flat file layout, so serve each client file explicitly rather than
// pointing express.static at the repo root and leaking server.js.
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.get('/games/:id.js', (req, res) => {
  const file = CLIENT_FILES[req.params.id];
  if (!file) return res.status(404).send('// no such game');
  res.type('application/javascript');
  res.sendFile(path.join(__dirname, file));
});

app.get('/healthz', (req, res) => res.send('ok'));

/* ---------- rooms --------------------------------------------------------- */

const rooms = new Map();      // code -> room
const sockets = new Map();    // socket.id -> { code, playerId }

function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ';   // no I or O
  let code;
  do {
    code = Array.from({ length: 4 }, () =>
      alphabet[crypto.randomInt(alphabet.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function createRoom() {
  const code = makeCode();
  const room = {
    code,
    createdAt: Date.now(),
    touchedAt: Date.now(),
    hostId: null,
    players: new Map(),     // playerId -> player
    order: [],              // join order, drives host succession
    phase: 'lobby',         // lobby | game | scores
    gameId: null,
    game: null,             // live game instance
    vote: null,
    lastRound: null,
  };
  rooms.set(code, room);
  return room;
}

function playerList(room) {
  return room.order
    .map(id => room.players.get(id))
    .filter(Boolean)
    .map(p => ({
      id: p.id, name: p.name, colour: p.colour, avatar: p.avatar,
      score: p.score, connected: p.connected, isHost: p.id === room.hostId,
    }));
}

function freeColour(room) {
  const taken = new Set([...room.players.values()].map(p => p.colour));
  return COLOURS.find(c => !taken.has(c)) || COLOURS[room.players.size % COLOURS.length];
}

function promoteHost(room) {
  const next = room.order
    .map(id => room.players.get(id))
    .find(p => p && p.connected);
  room.hostId = next ? next.id : null;
}

/* ---------- state push ---------------------------------------------------- */

function viewFor(room, playerId) {
  return {
    you: playerId,
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    players: playerList(room),
    games: GAME_LIST,
    gameId: room.gameId,
    gameName: room.gameId ? GAMES[room.gameId].name : null,
    game: room.game ? room.game.viewFor(playerId) : null,
    vote: room.vote ? {
      endsAt: room.vote.endsAt,
      tally: tallyVotes(room),
      mine: room.vote.picks.get(playerId) || null,
    } : null,
    lastRound: room.lastRound,
    serverNow: Date.now(),
  };
}

function push(room) {
  room.touchedAt = Date.now();
  for (const p of room.players.values()) {
    if (p.socketId) io.to(p.socketId).emit('state', viewFor(room, p.id));
  }
}

function banner(room, text, tone) {
  io.to(room.code).emit('banner', { text, tone: tone || 'info', at: Date.now() });
}

/* ---------- voting -------------------------------------------------------- */

function tallyVotes(room) {
  const t = {};
  GAME_LIST.forEach(g => { t[g.id] = 0; });
  for (const gid of room.vote.picks.values()) if (t[gid] != null) t[gid]++;
  return t;
}

function closeVote(room) {
  if (!room.vote) return;
  const tally = tallyVotes(room);
  clearTimeout(room.vote.timer);
  room.vote = null;

  let best = null, bestN = -1, tied = false;
  for (const [gid, n] of Object.entries(tally)) {
    if (n > bestN) { best = gid; bestN = n; tied = false; }
    else if (n === bestN) tied = true;
  }

  if (bestN <= 0 || tied) {
    banner(room, 'No clear winner. Host picks.', 'warn');
    push(room);
    return;
  }
  banner(room, `${GAMES[best].name} wins the vote`, 'good');
  startGame(room, best);
}

/* ---------- game lifecycle ------------------------------------------------ */

function startGame(room, gameId) {
  const mod = GAMES[gameId];
  if (!mod) return;
  const connected = [...room.players.values()].filter(p => p.connected);
  if (connected.length < (mod.minPlayers || 1)) {
    banner(room, `${mod.name} needs ${mod.minPlayers} players`, 'warn');
    push(room);
    return;
  }
  if (room.game && room.game.dispose) room.game.dispose();

  const ctx = {
    get players() {
      return room.order.map(id => room.players.get(id)).filter(Boolean)
        .map(p => ({ id: p.id, name: p.name, colour: p.colour, avatar: p.avatar, connected: p.connected }));
    },
    get hostId() { return room.hostId; },
    push: () => push(room),
    banner: (text, tone) => banner(room, text, tone),
    finish: (scores) => finishGame(room, scores),
  };

  room.gameId = gameId;
  room.game = mod.create(ctx);
  room.phase = 'game';
  room.lastRound = null;
  push(room);
}

function finishGame(room, scores) {
  const rows = [];
  for (const [pid, pts] of Object.entries(scores || {})) {
    const p = room.players.get(pid);
    if (!p) continue;
    p.score += pts;
    rows.push({ id: pid, name: p.name, colour: p.colour, avatar: p.avatar, points: pts });
  }
  rows.sort((a, b) => b.points - a.points);

  room.lastRound = {
    gameId: room.gameId,
    gameName: room.gameId ? GAMES[room.gameId].name : '',
    scores: rows,
  };
  if (room.game && room.game.dispose) room.game.dispose();
  room.game = null;
  room.gameId = null;
  room.phase = 'scores';
  push(room);
}

function backToLobby(room) {
  if (room.game && room.game.dispose) room.game.dispose();
  room.game = null;
  room.gameId = null;
  room.phase = 'lobby';
  push(room);
}

/* ---------- sockets ------------------------------------------------------- */

function ctxOf(socket) {
  const link = sockets.get(socket.id);
  if (!link) return null;
  const room = rooms.get(link.code);
  if (!room) return null;
  const player = room.players.get(link.playerId);
  if (!player) return null;
  return { room, player };
}

function isHost(room, player) { return room.hostId === player.id; }

function cleanName(n) {
  return String(n || '').trim().slice(0, 16) || 'Player';
}

function cleanAvatar(a) {
  if (typeof a !== 'string') return null;
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(a)) return null;
  if (a.length > 200000) return null;      // ~150KB — client should send far less
  return a;
}

io.on('connection', (socket) => {

  /* --- joining --------------------------------------------------------- */

  function seat(room, { token, name, avatar }, ack) {
    let player = [...room.players.values()].find(p => p.token === token);

    if (player) {
      // Returning player — iOS drops sockets constantly, so this is the
      // normal path, not the exception.
      player.connected = true;
      player.socketId = socket.id;
      player.name = cleanName(name) || player.name;
      if (avatar) player.avatar = cleanAvatar(avatar) || player.avatar;
      if (!room.hostId) room.hostId = player.id;
    } else {
      if (room.players.size >= MAX_PLAYERS) {
        return ack({ ok: false, error: 'That room is full.' });
      }
      player = {
        id: crypto.randomUUID(),
        token,
        name: cleanName(name),
        avatar: cleanAvatar(avatar),
        colour: freeColour(room),
        score: 0,
        connected: true,
        socketId: socket.id,
      };
      room.players.set(player.id, player);
      room.order.push(player.id);
      if (!room.hostId) room.hostId = player.id;
      if (room.game && room.game.onJoin) room.game.onJoin(player.id);
    }

    socket.join(room.code);
    sockets.set(socket.id, { code: room.code, playerId: player.id });
    ack({ ok: true, code: room.code, you: player.id });
    push(room);
  }

  socket.on('createRoom', (payload, ack) => {
    ack = typeof ack === 'function' ? ack : () => {};
    const room = createRoom();
    seat(room, payload || {}, ack);
    console.log(`room ${room.code} created`);
  });

  socket.on('joinRoom', (payload, ack) => {
    ack = typeof ack === 'function' ? ack : () => {};
    const code = String((payload && payload.code) || '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return ack({ ok: false, error: 'No room with that code.' });
    seat(room, payload || {}, ack);
  });

  /* --- lobby ----------------------------------------------------------- */

  socket.on('setColour', (colour) => {
    const c = ctxOf(socket); if (!c) return;
    if (!COLOURS.includes(colour)) return;
    const taken = [...c.room.players.values()].some(p => p.colour === colour && p.id !== c.player.id);
    if (taken) return;
    c.player.colour = colour;
    push(c.room);
  });

  socket.on('pickGame', (gameId) => {
    const c = ctxOf(socket); if (!c) return;
    if (!isHost(c.room, c.player)) return;
    if (!GAMES[gameId]) return;
    if (c.room.vote) { clearTimeout(c.room.vote.timer); c.room.vote = null; }
    startGame(c.room, gameId);
  });

  socket.on('openVote', () => {
    const c = ctxOf(socket); if (!c) return;
    const { room } = c;
    if (!isHost(room, c.player) || room.phase === 'game' || room.vote) return;
    room.vote = {
      picks: new Map(),
      endsAt: Date.now() + VOTE_SECONDS * 1000,
      timer: setTimeout(() => closeVote(room), VOTE_SECONDS * 1000),
    };
    banner(room, 'Vote for the next game', 'info');
    push(room);
  });

  socket.on('castVote', (gameId) => {
    const c = ctxOf(socket); if (!c) return;
    const { room } = c;
    if (!room.vote || !GAMES[gameId]) return;
    room.vote.picks.set(c.player.id, gameId);
    // Everyone has voted, so don't make them watch the clock run out.
    const live = [...room.players.values()].filter(p => p.connected).length;
    if (room.vote.picks.size >= live) return closeVote(room);
    push(room);
  });

  socket.on('closeVote', () => {
    const c = ctxOf(socket); if (!c) return;
    if (isHost(c.room, c.player)) closeVote(c.room);
  });

  socket.on('backToLobby', () => {
    const c = ctxOf(socket); if (!c) return;
    if (isHost(c.room, c.player)) backToLobby(c.room);
  });

  socket.on('resetScores', () => {
    const c = ctxOf(socket); if (!c) return;
    if (!isHost(c.room, c.player)) return;
    for (const p of c.room.players.values()) p.score = 0;
    c.room.lastRound = null;
    banner(c.room, 'Scores wiped', 'warn');
    push(c.room);
  });

  socket.on('kick', (playerId) => {
    const c = ctxOf(socket); if (!c) return;
    if (!isHost(c.room, c.player) || playerId === c.player.id) return;
    const victim = c.room.players.get(playerId);
    if (!victim) return;
    if (victim.socketId) io.to(victim.socketId).emit('kicked');
    c.room.players.delete(playerId);
    c.room.order = c.room.order.filter(id => id !== playerId);
    if (c.room.game && c.room.game.onLeave) c.room.game.onLeave(playerId);
    push(c.room);
  });

  /* --- the single channel every mini game talks over -------------------- */

  socket.on('game', (msg) => {
    const c = ctxOf(socket); if (!c) return;
    if (!c.room.game || !msg || typeof msg.type !== 'string') return;
    try {
      c.room.game.onEvent(c.player.id, msg.type, msg.payload);
    } catch (err) {
      console.error(`game error in ${c.room.gameId}:`, err);
      banner(c.room, 'Something went wrong in that game.', 'warn');
    }
  });

  /* --- leaving ---------------------------------------------------------- */

  socket.on('disconnect', () => {
    const c = ctxOf(socket);
    sockets.delete(socket.id);
    if (!c) return;
    const { room, player } = c;
    if (player.socketId !== socket.id) return;   // already replaced by a reconnect
    player.connected = false;
    player.socketId = null;
    if (room.hostId === player.id) promoteHost(room);
    if (room.game && room.game.onLeave) room.game.onLeave(player.id);
    push(room);
  });
});

/* ---------- housekeeping -------------------------------------------------- */

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const anyone = [...room.players.values()].some(p => p.connected);
    if (!anyone && now - room.touchedAt > ROOM_TTL_MS) {
      if (room.game && room.game.dispose) room.game.dispose();
      rooms.delete(code);
      console.log(`room ${code} swept`);
    }
  }
}, 60000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Bingo Bango on ${PORT} — games: ${GAME_LIST.map(g => g.id).join(', ')}`);
});
