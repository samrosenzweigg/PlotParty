'use strict';
// Point Blank — Bingo Bango mini-game (server)
// Write savage endings to prompts about a secret player, then point your phone
// at who you think it's about. Writers score when the room points correctly.

const STEMS = [
  'Most likely to', 'Looks like they could', 'Would definitely be convicted of',
  'Is secretly', 'Their browser history is mostly', 'Will be remembered at their funeral for',
  'Is one bad day away from', 'Would sell out the whole group for',
  'Their villain origin story starts when', 'Would get kicked out of heaven for',
  'Has almost certainly', 'Would survive the apocalypse by', 'Peaked when they',
  "Their therapist's notes just say", 'Could lose a fight to',
  'Would die first in a horror movie because they', 'Their dating profile should warn you that they',
  'Would start a cult about', 'Has a restraining order from', 'Is only still invited because',
  'Their Wikipedia page would mostly be about', 'Would confess to a crime just to',
  'Could be bribed with', 'Their last words will be', 'Keeps a secret stash of',
  'Would get fired on day one for', 'Is lying to everyone about', 'Would trade a family member for',
  'Runs a burner account dedicated to', 'Would get cancelled for',
  'Looks like the kind of person who', 'Would get banned from Bunnings for',
  'Is the worst person to be stuck in a lift with because they', 'Was clearly raised by',
  'Would win a Darwin Award for', 'Has a search history that could get them arrested for',
  'Would dob in their own mum for', 'Is most likely to go viral for',
  'Will end up on A Current Affair for', 'Could talk their way out of',
];

const WRITE_MS_PER_CARD = 60000;
const CAL_MS = 120000;
const VOTE_MS = 25000;
const REVEAL_MS = 9000;
const MAX_TEXT = 110;
const POINTS_PER_VOTE = 100;

function shuffle(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ctx.players shape isn't guaranteed across shell versions — normalise to [{id,...}]
function listPlayers(players) {
  if (typeof players === 'function') players = players();
  if (!players) return [];
  if (players instanceof Map) return [...players.entries()].map(([k, v]) => Object.assign({ id: k }, v));
  if (Array.isArray(players)) return players.map(p => (typeof p === 'string' ? { id: p } : p));
  return Object.keys(players).map(k => Object.assign({ id: k }, players[k]));
}

module.exports = {
  id: 'pointblank',
  name: 'Point Blank',
  tagline: 'Write the roast, then point your phone at the guilty party.',
  minPlayers: 3,

  create(ctx) {
    const st = {
      phase: 'write', round: 0, cards: [], queue: [], cur: null,
      deadline: 0, scores: {}, present: new Set(), calibrated: {},
      votes: {}, usedStems: new Set(), timer: null, finished: false,
      nextCardId: 1, lastEarned: 0,
    };
    // Presence is read live from the shell: it doesn't call onJoin when an iOS
    // player reconnects, and ctx.players includes disconnected players.
    const presentIds = () => listPlayers(ctx.players).filter(p => p.connected !== false).map(p => p.id);
    const isPresent = pid => presentIds().includes(pid);
    presentIds().forEach(pid => { st.scores[pid] = 0; });

    const hostId = () => ctx.hostId;
    const canHost = pid => pid === hostId() || !isPresent(hostId());
    const clear = () => { if (st.timer) { clearTimeout(st.timer); st.timer = null; } };
    const at = (ms, fn) => { clear(); st.deadline = Date.now() + ms; st.timer = setTimeout(() => { st.timer = null; fn(); }, ms); };
    const push = () => { if (!st.finished) ctx.push(); };

    function cardsPerPlayer(n) { return n >= 6 ? 2 : 3; }
    function stemsNeeded() { const n = presentIds().length; return n * cardsPerPlayer(n); }
    function stemsLeft() { return STEMS.length - st.usedStems.size; }

    function pickStem(exclude) {
      const pool = STEMS.filter(s => !st.usedStems.has(s) && s !== exclude);
      const s = pool.length ? pool[Math.floor(Math.random() * pool.length)] : STEMS[Math.floor(Math.random() * STEMS.length)];
      st.usedStems.add(s);
      return s;
    }

    function startRound(quiet) {
      const ids = shuffle(presentIds());
      const n = ids.length;
      if (n < 3) return endGame('Not enough players left to keep going.');
      st.round += 1;
      const k = cardsPerPlayer(n);
      // Each round-slot uses a distinct offset so everyone is written about k times and never about themselves.
      let offsets = [];
      while (offsets.length < k) offsets = offsets.concat(shuffle([...Array(n - 1)].map((_, i) => i + 1)));
      st.cards = [];
      for (let slot = 0; slot < k; slot++) {
        ids.forEach((writer, i) => {
          st.cards.push({ id: 'c' + (st.nextCardId++), writer, target: ids[(i + offsets[slot]) % n], slot,
            stem: pickStem(), text: null, rerolled: false });
        });
      }
      st.phase = 'write';
      at(WRITE_MS_PER_CARD * k, endWrite);
      if (!quiet) push();
    }

    function myOpenCards(pid) { return st.cards.filter(c => c.writer === pid && c.text === null).sort((a, b) => a.slot - b.slot); }

    function maybeEndWrite() {
      if (st.phase !== 'write') return;
      if (presentIds().every(pid => myOpenCards(pid).length === 0)) endWrite();
    }
    function endWrite() {
      if (st.phase !== 'write') return;
      st.phase = 'calibrate';
      at(CAL_MS, startVoting);
      push();
    }

    function maybeEndCal() {
      if (st.phase === 'calibrate' && presentIds().every(pid => st.calibrated[pid])) startVoting();
    }
    function startVoting() {
      if (st.phase !== 'calibrate') return;
      st.queue = shuffle(st.cards.filter(c => c.text));
      if (!st.queue.length) { ctx.banner('Nobody finished a prompt — skipping to scores.', 'warn'); return toEnd(); }
      nextCard();
    }

    function voters() { return st.cur ? presentIds().filter(pid => pid !== st.cur.writer) : []; }

    function nextCard() {
      clear();
      if (presentIds().length < 2) return endGame('Everyone left.');
      while (st.queue.length) {
        const c = st.queue.shift();
        if (!isPresent(c.target)) continue; // can't point at someone who's gone
        st.cur = c; st.votes = {};
        if (!voters().length) continue;
        st.phase = 'vote';
        at(VOTE_MS, reveal);
        return push();
      }
      st.cur = null;
      toEnd();
    }

    function maybeReveal() {
      if (st.phase !== 'vote') return;
      const v = voters();
      if (v.length && v.every(pid => st.votes[pid])) reveal();
    }
    function reveal() {
      if (st.phase !== 'vote') return;
      const c = st.cur;
      const correct = Object.values(st.votes).filter(t => t === c.target).length;
      st.lastEarned = correct * POINTS_PER_VOTE;
      st.scores[c.writer] = (st.scores[c.writer] || 0) + st.lastEarned;
      st.phase = 'reveal';
      at(REVEAL_MS, nextCard);
      push();
    }

    function toEnd() { clear(); st.cur = null; st.phase = 'end'; st.deadline = 0; push(); }

    function endGame(msg) {
      if (st.finished) return;
      clear();
      if (msg) ctx.banner(msg, 'info');
      st.finished = true;
      const out = {};
      Object.keys(st.scores).forEach(pid => { if (st.scores[pid] > 0) out[pid] = st.scores[pid]; });
      ctx.finish(out);
    }

    startRound(true); // no push during create — the shell renders once we return

    return {
      viewFor(pid) {
        const v = {
          phase: st.phase, round: st.round, deadline: st.deadline, isHost: canHost(pid),
          present: presentIds(), scores: Object.assign({}, st.scores), maxText: MAX_TEXT,
        };
        if (st.phase === 'write') {
          const mine = st.cards.filter(c => c.writer === pid).sort((a, b) => a.slot - b.slot);
          const open = mine.find(c => c.text === null);
          v.total = mine.length;
          v.done = mine.filter(c => c.text !== null).length;
          v.card = open ? { id: open.id, stem: open.stem, target: open.target, canReroll: !open.rerolled } : null;
          v.waitingOn = presentIds().filter(p => myOpenCards(p).length > 0).length;
        } else if (st.phase === 'calibrate') {
          v.calibrated = Object.keys(st.calibrated).filter(p => isPresent(p));
        } else if (st.phase === 'vote' || st.phase === 'reveal') {
          const c = st.cur;
          v.card = { id: c.id, stem: c.stem, text: c.text };
          v.left = st.queue.length;
          v.amWriter = c.writer === pid;
          if (st.phase === 'vote') {
            v.voterCount = voters().length;
            v.votedCount = voters().filter(p => st.votes[p]).length;
            v.myVote = st.votes[pid] || null;
          } else {
            v.card.writer = c.writer;
            v.card.target = c.target;
            v.votes = Object.assign({}, st.votes);
            v.earned = st.lastEarned;
          }
        } else if (st.phase === 'end') {
          v.canAgain = stemsLeft() >= stemsNeeded();
        }
        return v;
      },

      onEvent(pid, type, payload) {
        if (st.finished) return;
        payload = payload || {};
        if (type === 'write' && st.phase === 'write') {
          const c = st.cards.find(x => x.id === payload.cardId && x.writer === pid);
          const text = String(payload.text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
          if (!c || c.text !== null || !text) return;
          c.text = text;
          push(); maybeEndWrite();
        } else if (type === 'reroll' && st.phase === 'write') {
          const c = st.cards.find(x => x.id === payload.cardId && x.writer === pid);
          if (!c || c.rerolled || c.text !== null) return;
          c.stem = pickStem(c.stem); c.rerolled = true;
          push();
        } else if (type === 'calibrated' && st.phase === 'calibrate') {
          st.calibrated[pid] = payload.mode === 'point' ? 'point' : 'tap';
          push(); maybeEndCal();
        } else if (type === 'vote' && st.phase === 'vote') {
          if (pid === st.cur.writer || !isPresent(payload.target)) return;
          st.votes[pid] = payload.target;
          push(); maybeReveal();
        } else if (type === 'advance' && canHost(pid)) {
          if (st.phase === 'write') endWrite();
          else if (st.phase === 'calibrate') startVoting();
          else if (st.phase === 'vote') reveal();
          else if (st.phase === 'reveal') nextCard();
        } else if (type === 'again' && canHost(pid) && st.phase === 'end') {
          if (stemsLeft() < stemsNeeded()) return ctx.banner("That's every prompt used up.", 'info');
          startRound();
        } else if (type === 'finish' && canHost(pid)) {
          endGame();
        }
      },

      onJoin(pid) {
        if (!(pid in st.scores)) st.scores[pid] = 0;
        push();
      },

      onLeave(pid) {
        if (st.phase !== 'end' && presentIds().length < 2) return endGame('Not enough players left.');
        if (st.phase === 'write') maybeEndWrite();
        else if (st.phase === 'calibrate') maybeEndCal();
        else if (st.phase === 'vote') {
          if (st.cur.target === pid) { ctx.banner('They left — skipping their card.', 'info'); return nextCard(); }
          Object.keys(st.votes).forEach(v => { if (st.votes[v] === pid) delete st.votes[v]; });
          if (!voters().length) return nextCard();
          maybeReveal();
        }
        push();
      },

      dispose() { clear(); st.finished = true; },
    };
  },
};
