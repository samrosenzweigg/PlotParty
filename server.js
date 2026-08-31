const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------- constants

const COLORS = [
  '#FF5D73', '#FFC145', '#4FD1A5', '#5B8DEF', '#C77DFF',
  '#FF8A3D', '#26D0CE', '#F27EB0', '#9BE564', '#FF6B4A'
];

const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O
const COUNTDOWN_CHOICES = [15, 30, 45, 60, 90];
const MAX_PLAYERS = 10;
const MAX_MARKS = 40;

const MODE_LABEL = { live: 'Live', reveal: 'Countdown', clue: 'Clue giver' };

/** @type {Map<string, object>} */
const rooms = new Map();

// ---------------------------------------------------------------- helpers

function makeCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () =>
      CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)]
    ).join('');
  } while (rooms.has(code));
  return code;
}

function makeRoom(code) {
  return {
    code,
    hostId: null,
    players: [],
    axes: { top: 'Overrated', bottom: 'Underrated', left: 'Boring', right: 'Chaotic' },
    mode: 'live',
    phase: 'lobby',
    turnIndex: 0,
    round: null,
    pendingTarget: null,
    boardMarks: [],           // averages kept on the board across rounds
    settings: { countdown: 45 },
    history: [],
    timer: null,
    deadline: null,
    createdAt: Date.now()
  };
}

const activePlayers = room => room.players.filter(p => p.connected);
const findPlayer = (room, id) => room.players.find(p => p.id === id);
const clamp01 = n =>
  typeof n !== 'number' || Number.isNaN(n) ? 0.5 : Math.min(1, Math.max(0, n));
const clean = (str, max) => String(str || '').replace(/\s+/g, ' ').trim().slice(0, max);
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function currentSubmitter(room) {
  const active = activePlayers(room);
  if (!active.length) return null;
  return active[room.turnIndex % active.length];
}

// A spot worth naming something for: not dead centre, not jammed in a corner.
function randomTarget() {
  let p;
  do {
    p = { x: 0.12 + Math.random() * 0.76, y: 0.12 + Math.random() * 0.76 };
  } while (distance(p, { x: 0.5, y: 0.5 }) < 0.18);
  return p;
}

function announce(room, kind, text, sub) {
  io.to(room.code).emit('announce', { kind, text, sub: sub || null });
}

function clearBoard(room, why) {
  room.boardMarks = [];
  room.players.forEach(p => { p.score = 0; });
  announce(room, 'cleared', 'Board wiped', why || 'Every mark is gone');
}

// ---------------------------------------------------------------- rounds

function beginRound(room) {
  clearTimer(room);
  room.round = null;
  room.pendingTarget = room.mode === 'clue' ? randomTarget() : null;
  room.phase = 'submit';
  broadcast(room);
}

function startPlacing(room, item, submitterId) {
  room.round = {
    item,
    submitterId,
    target: room.mode === 'clue' ? room.pendingTarget : null,
    placements: {},
    locked: {},
    scores: null
  };
  room.pendingTarget = null;
  room.phase = 'place';
  if (room.mode === 'reveal') startTimer(room, room.settings.countdown);
  broadcast(room);
}

function expectedPlacers(room) {
  const active = activePlayers(room);
  if (room.mode === 'clue') return active.filter(p => p.id !== room.round.submitterId);
  return active;
}

function maybeReveal(room) {
  const expected = expectedPlacers(room);
  if (!expected.length) return;
  if (expected.every(p => room.round.locked[p.id])) revealRound(room);
}

function revealRound(room) {
  clearTimer(room);
  if (!room.round || room.phase === 'reveal') return;

  const round = room.round;
  const ids = Object.keys(round.placements);

  if (ids.length) {
    round.average = {
      x: ids.reduce((s, id) => s + round.placements[id].x, 0) / ids.length,
      y: ids.reduce((s, id) => s + round.placements[id].y, 0) / ids.length
    };
    let far = null;
    for (const id of ids) {
      const d = distance(round.placements[id], round.average);
      if (!far || d > far.d) far = { id, d };
    }
    round.outlierId = ids.length > 2 ? far.id : null;
    round.spread =
      ids.reduce((s, id) => s + distance(round.placements[id], round.average), 0) / ids.length;
  }

  // Clue mode: everyone is scored against the spot the grid picked.
  if (room.mode === 'clue' && round.target) {
    round.scores = {};
    let total = 0;
    for (const id of ids) {
      const pts = Math.max(0, Math.round(
        100 * (1 - Math.min(distance(round.placements[id], round.target), 1))
      ));
      round.scores[id] = pts;
      total += pts;
      const p = findPlayer(room, id);
      if (p) p.score += pts;
    }
    // The namer is scored on how well the group found their thing.
    if (ids.length) {
      const bonus = Math.round(total / ids.length);
      round.scores[round.submitterId] = bonus;
      const namer = findPlayer(room, round.submitterId);
      if (namer) namer.score += bonus;
    }
  }

  if (round.average) {
    room.boardMarks.push({
      item: round.item,
      x: round.average.x,
      y: round.average.y,
      spread: round.spread || 0
    });
    if (room.boardMarks.length > MAX_MARKS) room.boardMarks.shift();
  }

  room.phase = 'reveal';
  announce(room, 'reveal', round.item, 'Everyone in');
  broadcast(room);
}

function nextRound(room) {
  if (room.round) room.history.push({ item: room.round.item });
  const active = activePlayers(room);
  if (active.length) room.turnIndex = (room.turnIndex + 1) % active.length;
  beginRound(room);
}

// ---------------------------------------------------------------- timer

function clearTimer(room) {
  if (room.timer) clearInterval(room.timer);
  room.timer = null;
  room.deadline = null;
}

function startTimer(room, seconds) {
  clearTimer(room);
  room.deadline = Date.now() + seconds * 1000;
  room.timer = setInterval(() => {
    if (Date.now() >= room.deadline) revealRound(room);
    else io.to(room.code).emit('tick', {
      secondsLeft: Math.ceil((room.deadline - Date.now()) / 1000)
    });
  }, 400);
}

// ---------------------------------------------------------------- state view

function viewFor(room, viewerId) {
  const round = room.round;
  const submitter = currentSubmitter(room);

  let visible = {};
  if (round) {
    const showAll = room.phase === 'reveal' || (room.mode === 'live' && room.phase === 'place');
    if (showAll) visible = round.placements;
    else if (round.placements[viewerId]) visible = { [viewerId]: round.placements[viewerId] };
  }

  // Only the person naming the thing sees where the grid pointed.
  let myTarget = null;
  if (room.mode === 'clue') {
    if (room.phase === 'submit' && submitter && submitter.id === viewerId) {
      myTarget = room.pendingTarget;
    } else if (round && round.submitterId === viewerId) {
      myTarget = round.target;
    }
  }

  return {
    code: room.code,
    hostId: room.hostId,
    you: viewerId,
    mode: room.mode,
    phase: room.phase,
    axes: room.axes,
    settings: room.settings,
    countdownChoices: COUNTDOWN_CHOICES,
    palette: COLORS,
    takenColors: room.players.filter(p => p.id !== viewerId).map(p => p.color),
    boardMarks: room.boardMarks,
    players: room.players.map(p => ({
      id: p.id, name: p.name, color: p.color,
      connected: p.connected, score: p.score,
      hasPlaced: round ? !!round.placements[p.id] : false,
      locked: round ? !!round.locked[p.id] : false
    })),
    submitterId: submitter ? submitter.id : null,
    myTarget,
    secondsLeft: room.deadline
      ? Math.max(0, Math.ceil((room.deadline - Date.now()) / 1000)) : null,
    round: round && {
      item: round.item,
      submitterId: round.submitterId,
      target: room.phase === 'reveal' ? round.target : null,
      placements: visible,
      average: round.average || null,
      outlierId: round.outlierId || null,
      scores: round.scores || null
    },
    roundsPlayed: room.history.length
  };
}

function broadcast(room) {
  for (const p of room.players) {
    if (p.connected) io.to(p.id).emit('state', viewFor(room, p.id));
  }
}

// ---------------------------------------------------------------- sockets

io.on('connection', socket => {
  let roomCode = null;
  const getRoom = () => (roomCode ? rooms.get(roomCode) : null);
  const isHost = room => room && room.hostId === socket.id;

  function attach(room, name) {
    const used = room.players.map(p => p.color);
    const color = COLORS.find(c => !used.includes(c)) || COLORS[room.players.length % COLORS.length];
    const player = { id: socket.id, name: clean(name, 16) || 'Player', color, connected: true, score: 0 };
    room.players.push(player);
    roomCode = room.code;
    socket.join(room.code);
    return player;
  }

  socket.on('createRoom', ({ name }, ack) => {
    const room = makeRoom(makeCode());
    rooms.set(room.code, room);
    const player = attach(room, name);
    room.hostId = player.id;
    if (typeof ack === 'function') ack({ ok: true, code: room.code });
    broadcast(room);
  });

  socket.on('joinRoom', ({ code, name }, ack) => {
    const room = rooms.get(clean(code, 4).toUpperCase());
    if (!room) return ack && ack({ ok: false, error: 'No room with that code.' });
    if (activePlayers(room).length >= MAX_PLAYERS) {
      return ack && ack({ ok: false, error: `Room is full (${MAX_PLAYERS} players).` });
    }
    const p = attach(room, name);
    if (typeof ack === 'function') ack({ ok: true, code: room.code });
    announce(room, 'join', `${p.name} is in`, null);
    broadcast(room);
  });

  socket.on('setColor', hex => {
    const room = getRoom();
    if (!room || room.phase !== 'lobby' || !COLORS.includes(hex)) return;
    if (room.players.some(p => p.id !== socket.id && p.color === hex)) return;
    const me = findPlayer(room, socket.id);
    if (me) me.color = hex;
    broadcast(room);
  });

  socket.on('setAxes', axes => {
    const room = getRoom();
    if (!isHost(room)) return;
    room.axes = {
      top: clean(axes.top, 24) || room.axes.top,
      bottom: clean(axes.bottom, 24) || room.axes.bottom,
      left: clean(axes.left, 24) || room.axes.left,
      right: clean(axes.right, 24) || room.axes.right
    };
    broadcast(room);
  });

  socket.on('setMode', mode => {
    const room = getRoom();
    if (!isHost(room) || !MODE_LABEL[mode] || room.mode === mode) return;
    room.mode = mode;
    clearBoard(room, 'New mode, fresh grid');
    announce(room, 'mode', MODE_LABEL[mode], 'Mode changed');
    if (room.phase !== 'lobby') beginRound(room);
    else broadcast(room);
  });

  socket.on('setCountdown', secs => {
    const room = getRoom();
    if (!isHost(room) || !COUNTDOWN_CHOICES.includes(secs)) return;
    room.settings.countdown = secs;
    broadcast(room);
  });

  socket.on('clearBoard', () => {
    const room = getRoom();
    if (!isHost(room)) return;
    clearBoard(room);
    broadcast(room);
  });

  socket.on('startGame', () => {
    const room = getRoom();
    if (!isHost(room) || room.phase !== 'lobby') return;
    room.turnIndex = 0;
    announce(room, 'start', 'Here we go', MODE_LABEL[room.mode]);
    beginRound(room);
  });

  socket.on('submitItem', item => {
    const room = getRoom();
    if (!room || room.phase !== 'submit') return;
    const submitter = currentSubmitter(room);
    if (!submitter || submitter.id !== socket.id) return;
    const text = clean(item, 60);
    if (!text) return;
    startPlacing(room, text, socket.id);
  });

  socket.on('place', ({ x, y }) => {
    const room = getRoom();
    if (!room || !room.round || room.phase !== 'place') return;
    if (!expectedPlacers(room).some(p => p.id === socket.id)) return;
    if (room.round.locked[socket.id]) return;
    room.round.placements[socket.id] = { x: clamp01(x), y: clamp01(y) };
    broadcast(room);
  });

  socket.on('lockIn', () => {
    const room = getRoom();
    if (!room || !room.round || room.phase !== 'place') return;
    if (!room.round.placements[socket.id]) return;
    room.round.locked[socket.id] = true;
    broadcast(room);
    maybeReveal(room);
  });

  socket.on('revealNow', () => {
    const room = getRoom();
    if (isHost(room) && room.phase === 'place') revealRound(room);
  });

  socket.on('nextRound', () => {
    const room = getRoom();
    if (!room || room.phase !== 'reveal') return;
    const sub = room.round && room.round.submitterId;
    if (!isHost(room) && sub !== socket.id) return;
    nextRound(room);
  });

  socket.on('backToLobby', () => {
    const room = getRoom();
    if (!isHost(room)) return;
    clearTimer(room);
    room.phase = 'lobby';
    room.round = null;
    room.pendingTarget = null;
    announce(room, 'lobby', 'Back to the lobby', 'Board kept');
    broadcast(room);
  });

  socket.on('disconnect', () => {
    const room = getRoom();
    if (!room) return;
    const player = findPlayer(room, socket.id);
    if (!player) return;

    if (room.phase === 'lobby') room.players = room.players.filter(p => p.id !== socket.id);
    else player.connected = false;

    if (room.hostId === socket.id) {
      const next = activePlayers(room)[0];
      room.hostId = next ? next.id : null;
    }

    if (!activePlayers(room).length) {
      clearTimer(room);
      rooms.delete(room.code);
      return;
    }

    if (room.round && room.phase === 'place') maybeReveal(room);
    if (room.phase === 'submit' && !currentSubmitter(room)) beginRound(room);
    broadcast(room);
  });
});

setInterval(() => {
  const cutoff = Date.now() - 1000 * 60 * 60 * 6;
  for (const [code, room] of rooms) {
    if (!activePlayers(room).length && room.createdAt < cutoff) {
      clearTimer(room);
      rooms.delete(code);
    }
  }
}, 1000 * 60 * 10);

server.listen(PORT, () => console.log(`Plot Party running on http://localhost:${PORT}`));
