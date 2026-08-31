const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Everything the browser needs lives in one file.
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------- constants

const COLORS = [
  '#FF5D73', '#FFC145', '#4FD1A5', '#5B8DEF',
  '#C77DFF', '#FF8A3D', '#26D0CE', '#F27EB0'
];

const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O
const REVEAL_SECONDS = 45;
const MAX_PLAYERS = 8;

/** @type {Map<string, Room>} */
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
    history: [],
    timer: null,
    deadline: null,
    createdAt: Date.now()
  };
}

function activePlayers(room) {
  return room.players.filter(p => p.connected);
}

function findPlayer(room, id) {
  return room.players.find(p => p.id === id);
}

function clamp01(n) {
  if (typeof n !== 'number' || Number.isNaN(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

function clean(str, max) {
  return String(str || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// The player whose turn it is to submit a thing.
function currentSubmitter(room) {
  const active = activePlayers(room);
  if (!active.length) return null;
  return active[room.turnIndex % active.length];
}

// ---------------------------------------------------------------- rounds

function beginRound(room) {
  clearTimer(room);
  room.round = null;
  room.phase = 'submit';
  broadcast(room);
}

function startPlacing(room, item, submitterId) {
  room.round = {
    item,
    submitterId,
    placements: {},   // playerId -> {x, y}
    locked: {},       // playerId -> true
    scores: null
  };
  if (room.mode === 'clue') {
    room.phase = 'clue-place';
  } else {
    room.phase = 'place';
    if (room.mode === 'reveal') startTimer(room, REVEAL_SECONDS);
  }
  broadcast(room);
}

// Who is expected to lock in during the current placing phase?
function expectedPlacers(room) {
  const active = activePlayers(room);
  if (room.phase === 'clue-place') {
    return active.filter(p => p.id === room.round.submitterId);
  }
  if (room.phase === 'place' && room.mode === 'clue') {
    return active.filter(p => p.id !== room.round.submitterId);
  }
  return active;
}

function maybeReveal(room) {
  const expected = expectedPlacers(room);
  if (!expected.length) return;
  const allIn = expected.every(p => room.round.locked[p.id]);
  if (!allIn) return;

  if (room.phase === 'clue-place') {
    room.phase = 'place';
    broadcast(room);
    return;
  }
  revealRound(room);
}

function revealRound(room) {
  clearTimer(room);
  if (!room.round) return;

  const round = room.round;
  const guesserIds = Object.keys(round.placements).filter(
    id => !(room.mode === 'clue' && id === round.submitterId)
  );

  // Average of everyone's placement (the clue-giver's target is excluded in clue mode).
  if (guesserIds.length) {
    round.average = {
      x: guesserIds.reduce((s, id) => s + round.placements[id].x, 0) / guesserIds.length,
      y: guesserIds.reduce((s, id) => s + round.placements[id].y, 0) / guesserIds.length
    };
    // Furthest from the pack — the fun stat.
    let far = null;
    for (const id of guesserIds) {
      const d = distance(round.placements[id], round.average);
      if (!far || d > far.d) far = { id, d };
    }
    round.outlierId = guesserIds.length > 2 ? far.id : null;
  }

  // Clue mode: score each guess against the clue-giver's secret placement.
  if (room.mode === 'clue' && round.placements[round.submitterId]) {
    const target = round.placements[round.submitterId];
    round.scores = {};
    for (const id of guesserIds) {
      const d = distance(round.placements[id], target);
      const points = Math.max(0, Math.round(100 * (1 - Math.min(d, 1))));
      round.scores[id] = points;
      const p = findPlayer(room, id);
      if (p) p.score += points;
    }
  }

  room.phase = 'reveal';
  broadcast(room);
}

function nextRound(room) {
  if (room.round) {
    room.history.push({ item: room.round.item, average: room.round.average || null });
  }
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
    if (Date.now() >= room.deadline) {
      revealRound(room);
    } else {
      io.to(room.code).emit('tick', {
        secondsLeft: Math.ceil((room.deadline - Date.now()) / 1000)
      });
    }
  }, 500);
}

// ---------------------------------------------------------------- state view

// Each player gets their own view: hidden placements stay hidden.
function viewFor(room, viewerId) {
  const round = room.round;
  const submitter = currentSubmitter(room);

  let visible = {};
  let placedIds = [];

  if (round) {
    placedIds = Object.keys(round.placements);
    const showAll =
      room.phase === 'reveal' ||
      (room.mode === 'live' && room.phase === 'place');

    if (showAll) {
      visible = round.placements;
    } else if (round.placements[viewerId]) {
      visible = { [viewerId]: round.placements[viewerId] };
    }
  }

  return {
    code: room.code,
    hostId: room.hostId,
    you: viewerId,
    mode: room.mode,
    phase: room.phase,
    axes: room.axes,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      color: p.color,
      connected: p.connected,
      score: p.score,
      hasPlaced: round ? placedIds.includes(p.id) : false,
      locked: round ? !!round.locked[p.id] : false
    })),
    submitterId: submitter ? submitter.id : null,
    secondsLeft: room.deadline
      ? Math.max(0, Math.ceil((room.deadline - Date.now()) / 1000))
      : null,
    round: round && {
      item: round.item,
      submitterId: round.submitterId,
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

  function attach(room, name) {
    const used = room.players.map(p => p.color);
    const color = COLORS.find(c => !used.includes(c)) || COLORS[room.players.length % COLORS.length];
    const player = {
      id: socket.id,
      name: clean(name, 16) || 'Player',
      color,
      connected: true,
      score: 0
    };
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
    attach(room, name);
    if (typeof ack === 'function') ack({ ok: true, code: room.code });
    broadcast(room);
  });

  socket.on('setAxes', axes => {
    const room = getRoom();
    if (!room || room.hostId !== socket.id) return;
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
    if (!room || room.hostId !== socket.id) return;
    if (!['live', 'reveal', 'clue'].includes(mode)) return;
    room.mode = mode;
    broadcast(room);
  });

  socket.on('startGame', () => {
    const room = getRoom();
    if (!room || room.hostId !== socket.id || room.phase !== 'lobby') return;
    room.players.forEach(p => { p.score = 0; });
    room.turnIndex = 0;
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
    if (!room || !room.round) return;
    if (room.phase !== 'place' && room.phase !== 'clue-place') return;
    if (!expectedPlacers(room).some(p => p.id === socket.id)) return;
    if (room.round.locked[socket.id]) return;

    room.round.placements[socket.id] = { x: clamp01(x), y: clamp01(y) };

    if (room.mode === 'live') {
      broadcast(room); // everyone watches the dot move
    } else {
      // Others only need to know that this player has placed something.
      broadcast(room);
    }
  });

  socket.on('lockIn', () => {
    const room = getRoom();
    if (!room || !room.round) return;
    if (room.phase !== 'place' && room.phase !== 'clue-place') return;
    if (!room.round.placements[socket.id]) return;
    room.round.locked[socket.id] = true;
    broadcast(room);
    maybeReveal(room);
  });

  socket.on('revealNow', () => {
    const room = getRoom();
    if (!room || room.hostId !== socket.id) return;
    if (room.phase === 'place') revealRound(room);
  });

  socket.on('nextRound', () => {
    const room = getRoom();
    if (!room || room.phase !== 'reveal') return;
    if (room.hostId !== socket.id && currentSubmitter(room)?.id !== socket.id) return;
    nextRound(room);
  });

  socket.on('backToLobby', () => {
    const room = getRoom();
    if (!room || room.hostId !== socket.id) return;
    clearTimer(room);
    room.phase = 'lobby';
    room.round = null;
    room.history = [];
    broadcast(room);
  });

  socket.on('disconnect', () => {
    const room = getRoom();
    if (!room) return;
    const player = findPlayer(room, socket.id);
    if (!player) return;

    if (room.phase === 'lobby') {
      room.players = room.players.filter(p => p.id !== socket.id);
    } else {
      player.connected = false;
    }

    if (room.hostId === socket.id) {
      const next = activePlayers(room)[0];
      room.hostId = next ? next.id : null;
    }

    if (!activePlayers(room).length) {
      clearTimer(room);
      rooms.delete(room.code);
      return;
    }

    // Don't let a dropped player stall the round.
    if (room.round && (room.phase === 'place' || room.phase === 'clue-place')) {
      maybeReveal(room);
    }
    if (room.phase === 'submit' && !currentSubmitter(room)) beginRound(room);
    broadcast(room);
  });
});

// Sweep out rooms nobody came back to.
setInterval(() => {
  const cutoff = Date.now() - 1000 * 60 * 60 * 6;
  for (const [code, room] of rooms) {
    if (!activePlayers(room).length && room.createdAt < cutoff) {
      clearTimer(room);
      rooms.delete(code);
    }
  }
}, 1000 * 60 * 10);

server.listen(PORT, () => {
  console.log(`Plot Party running on http://localhost:${PORT}`);
});
