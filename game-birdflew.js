'use strict';

/* ------------------------------------------------------------------
   Bird Flew  —  a Bingo Bango mini-game (server half)
   File lives flat in the repo root as: game-birdflew.js

   Flow:  intro -> name -> sound -> draw -> reveal
          -> [ vote -> matchresult ] x N (single-elimination)
          -> champion -> ctx.finish(scores)

   Scoring: 10 per match won, 2 per vote the bird received,
            15 champion bonus, 5 for a finished bird (name + drawing).
   ------------------------------------------------------------------ */

const DUR = {
  name: 40000,
  sound: 60000,
  draw: 165000,
  reveal: 11000,
  vote: 25000,
  matchresult: 6500,
  champion: 180000, // watchdog; host can end sooner
};

const MAX_NAME_LEN = 28;
const MAX_CALL_LEN = 18;
const MAX_AUDIO_CHARS = 700000; // base64 string length, well under the 2MB socket ceiling
const MAX_IMG_CHARS = 320000;
const ART_PER_PUSH = 2; // birds' artwork is trickled out so no single view is huge

const FALLBACK_NAMES = [
  'Unnamed Warbler',
  'The Shy Nothing',
  'Blank-faced Loon',
  'Forgotten Finch',
  'Absentee Grebe',
  'Quiet Bushfowl',
  'Mystery Snipe',
];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

function clean(value, max) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

// The shell has handed us ctx.players; be liberal about its exact shape.
function normPlayers(raw) {
  const out = [];
  if (!raw) return out;
  const list = Array.isArray(raw) ? raw : (raw instanceof Map ? Array.from(raw.values()) : Object.values(raw));
  for (const p of list) {
    if (!p) continue;
    if (typeof p === 'string') { out.push({ id: p, name: p }); continue; }
    const id = p.id || p.playerId || p.pid;
    if (!id) continue;
    out.push({ id: String(id), name: p.name || p.nick || p.displayName || 'Bird nerd' });
  }
  return out;
}

function roundTitle(n) {
  if (n <= 2) return 'The final';
  if (n <= 4) return 'Semi-finals';
  if (n <= 8) return 'Quarter-finals';
  return 'Round of ' + n;
}

function pointsFor(bird, championId) {
  let pts = bird.wins * 10 + bird.votes * 2;
  if (bird.id === championId) pts += 15;
  if (bird.name && bird.body) pts += 5;
  return pts;
}

module.exports = {
  id: 'birdflew',
  name: 'Bird Flew',
  tagline: 'Invent a bird. Give it a voice. Watch it fight.',
  minPlayers: 2,

  create(ctx) {
    const S = {
      phase: 'intro',
      endsAt: null,
      birds: new Map(),      // playerId -> bird
      done: new Set(),       // who has submitted for the current creation round
      round: 0,
      roundName: '',
      entrants: [],
      nextEntrants: [],
      matches: [],
      matchIndex: 0,
      match: null,
      byeId: null,
      champion: null,
      delivered: new Map(),  // playerId -> Set of bird ids whose art they already hold
      pushTimer: null,
      heartbeat: null,
      finished: false,
      dead: false,
    };

    function players() { return normPlayers(ctx.players); }
    function playerIds() { return players().map(function (p) { return p.id; }); }
    function nameOf(id) {
      const p = players().find(function (x) { return x.id === id; });
      return p ? p.name : (S.birds.has(id) ? S.birds.get(id).ownerName : 'Someone');
    }

    function push() { try { ctx.push(); } catch (e) { /* shell went away */ } }

    function schedulePush(ms) {
      if (S.dead || S.pushTimer) return;
      S.pushTimer = setTimeout(function () { S.pushTimer = null; push(); }, ms || 400);
    }

    function banner(text, tone) {
      try { ctx.banner(text, tone || 'info'); } catch (e) { /* optional */ }
    }

    /* ---------------- birds ---------------- */

    function makeBird(id) {
      if (S.birds.has(id)) return S.birds.get(id);
      const bird = {
        id: id,
        ownerName: nameOf(id),
        name: '',
        call: '',
        audio: null,
        body: null,
        wing: null,
        wins: 0,
        votes: 0,
        out: false,
        outRound: 0,
      };
      S.birds.set(id, bird);
      return bird;
    }

    function hatchAll() {
      playerIds().forEach(makeBird);
    }

    /* ---------------- phases ---------------- */

    function beginPhase(phase) {
      S.phase = phase;
      S.done = new Set();
      S.endsAt = DUR[phase] ? Date.now() + DUR[phase] : null;
      push();
    }

    function creationRoundIsDone() {
      const ids = playerIds().filter(function (id) { return S.birds.has(id); });
      if (!ids.length) return true;
      return ids.every(function (id) { return S.done.has(id); });
    }

    function tidyNames() {
      S.birds.forEach(function (b) {
        if (!b.name) b.name = pick(FALLBACK_NAMES);
      });
    }

    function advance() {
      switch (S.phase) {
        case 'intro':
          hatchAll();
          beginPhase('name');
          break;
        case 'name':
          tidyNames();
          beginPhase('sound');
          break;
        case 'sound':
          beginPhase('draw');
          break;
        case 'draw':
          openBracket();
          break;
        case 'reveal':
          nextStep();
          break;
        case 'vote':
          resolveMatch();
          break;
        case 'matchresult':
          nextStep();
          break;
        case 'champion':
          doFinish();
          break;
        default:
          break;
      }
    }

    /* ---------------- bracket ---------------- */

    function openBracket() {
      tidyNames();
      const ids = shuffle(Array.from(S.birds.keys()));
      if (ids.length <= 1) {
        S.champion = ids[0] || null;
        beginPhase('champion');
        return;
      }
      S.entrants = ids;
      S.round = 0;
      startRound();
      beginPhase('reveal');
    }

    function startRound() {
      S.round += 1;
      S.roundName = roundTitle(S.entrants.length);
      const queue = S.entrants.slice();
      S.matches = [];
      S.nextEntrants = [];
      S.byeId = null;
      while (queue.length >= 2) {
        S.matches.push({ a: queue.shift(), b: queue.shift() });
      }
      if (queue.length === 1) {
        S.byeId = queue.shift();
        S.nextEntrants.push(S.byeId);
      }
      S.matchIndex = 0;
    }

    function openMatch() {
      const m = S.matches[S.matchIndex];
      S.match = { a: m.a, b: m.b, votes: {}, winner: null, loser: null, gust: false, tally: { a: 0, b: 0 } };
      beginPhase('vote');
    }

    function nextStep() {
      if (S.matchIndex + 1 < S.matches.length && S.match) {
        S.matchIndex += 1;
        openMatch();
        return;
      }
      if (!S.match && S.matches.length) { // coming out of reveal
        openMatch();
        return;
      }
      S.entrants = S.nextEntrants.slice();
      if (S.entrants.length <= 1) {
        S.champion = S.entrants[0] || null;
        S.match = null;
        beginPhase('champion');
        return;
      }
      startRound();
      openMatch();
    }

    function eligibleVoters() {
      const m = S.match;
      if (!m) return [];
      const all = playerIds();
      const others = all.filter(function (id) { return id !== m.a && id !== m.b; });
      return others.length ? others : all; // 2-player game: the owners judge each other
    }

    function resolveMatch() {
      const m = S.match;
      if (!m) { nextStep(); return; }
      const A = S.birds.get(m.a);
      const B = S.birds.get(m.b);
      let a = 0, b = 0;
      Object.keys(m.votes).forEach(function (voter) {
        if (m.votes[voter] === 'a') a += 1;
        else if (m.votes[voter] === 'b') b += 1;
      });
      m.tally = { a: a, b: b };
      if (A) A.votes += a;
      if (B) B.votes += b;

      let winner;
      if (a > b) winner = 'a';
      else if (b > a) winner = 'b';
      else {
        m.gust = true;
        const av = A ? A.votes : 0;
        const bv = B ? B.votes : 0;
        if (av > bv) winner = 'a';
        else if (bv > av) winner = 'b';
        else winner = Math.random() < 0.5 ? 'a' : 'b';
      }
      m.winner = winner === 'a' ? m.a : m.b;
      m.loser = winner === 'a' ? m.b : m.a;

      const W = S.birds.get(m.winner);
      const L = S.birds.get(m.loser);
      if (W) W.wins += 1;
      if (L) { L.out = true; L.outRound = S.round; }
      S.nextEntrants.push(m.winner);

      if (m.gust) banner('Dead heat. A gust of wind decides it.', 'info');
      beginPhase('matchresult');
    }

    /* ---------------- art delivery ---------------- */

    function artNeededFor(phase) {
      if (phase === 'reveal' || phase === 'champion') return Array.from(S.birds.keys());
      if ((phase === 'vote' || phase === 'matchresult') && S.match) return [S.match.a, S.match.b];
      return [];
    }

    // viewFor must stay side-effect free (the shell may build a view it never
    // sends), so delivery is driven by the client acknowledging each parcel.
    function artParcel(playerId) {
      const need = artNeededFor(S.phase);
      if (!need.length) return { art: [], pending: 0 };
      const set = S.delivered.get(playerId) || new Set();
      const missing = need.filter(function (id) { return S.birds.has(id) && !set.has(id); });
      if (!missing.length) return { art: [], pending: 0 };
      const art = missing.slice(0, ART_PER_PUSH).map(function (id) {
        const b = S.birds.get(id);
        return { id: id, body: b.body, wing: b.wing, audio: b.audio };
      });
      return { art: art, pending: missing.length - art.length };
    }

    /* ---------------- scoring / finish ---------------- */

    function standings() {
      const rows = [];
      S.birds.forEach(function (b) {
        rows.push({
          id: b.id,
          name: b.name,
          call: b.call,
          owner: b.ownerName,
          wins: b.wins,
          votes: b.votes,
          out: b.out,
          outRound: b.outRound,
          hasAudio: !!b.audio,
          points: pointsFor(b, S.champion),
        });
      });
      rows.sort(function (x, y) { return y.points - x.points || y.wins - x.wins; });
      return rows;
    }

    function doFinish() {
      if (S.finished) return;
      S.finished = true;
      const scores = {};
      S.birds.forEach(function (b) {
        scores[b.id] = (scores[b.id] || 0) + pointsFor(b, S.champion);
      });
      try { ctx.finish(scores); } catch (e) { /* shell handles the rest */ }
    }

    /* ---------------- heartbeat ---------------- */

    S.heartbeat = setInterval(function () {
      if (S.dead) return;
      if (S.endsAt && Date.now() >= S.endsAt) advance();
    }, 500);
    if (S.heartbeat && S.heartbeat.unref) S.heartbeat.unref();

    /* ---------------- module object ---------------- */

    return {
      viewFor: function (playerId) {
        const bird = S.birds.get(playerId) || null;
        const isHost = playerId === ctx.hostId;
        const parcel = artParcel(playerId);
        const roster = players();

        const view = {
          phase: S.phase,
          endsAt: S.endsAt,
          round: S.round,
          roundName: S.roundName,
          isHost: isHost,
          playerCount: roster.length,
          art: parcel.art,
          artPending: parcel.pending,
          myBird: bird ? {
            name: bird.name,
            call: bird.call,
            hasAudio: !!bird.audio,
            hasBody: !!bird.body,
            hasWing: !!bird.wing,
          } : null,
          submitted: S.done.has(playerId),
          doneCount: S.done.size,
          total: S.birds.size || roster.length,
        };

        if (S.phase === 'reveal') {
          view.flock = Array.from(S.birds.values()).map(function (b) {
            return { id: b.id, name: b.name, call: b.call, owner: b.ownerName, hasAudio: !!b.audio };
          });
        }

        if (S.phase === 'vote' || S.phase === 'matchresult') {
          const m = S.match;
          if (m) {
            const A = S.birds.get(m.a);
            const B = S.birds.get(m.b);
            const eligible = eligibleVoters();
            view.match = {
              index: S.matchIndex + 1,
              of: S.matches.length,
              a: A ? { id: A.id, name: A.name, call: A.call, owner: A.ownerName, hasAudio: !!A.audio } : null,
              b: B ? { id: B.id, name: B.name, call: B.call, owner: B.ownerName, hasAudio: !!B.audio } : null,
              canVote: eligible.indexOf(playerId) !== -1,
              myVote: m.votes[playerId] || null,
              votesIn: Object.keys(m.votes).length,
              votersNeeded: eligible.length,
            };
            if (S.phase === 'matchresult') {
              view.match.winnerId = m.winner;
              view.match.loserId = m.loser;
              view.match.tally = m.tally;
              view.match.gust = m.gust;
            }
          }
          if (S.byeId && S.matchIndex === 0 && S.phase === 'vote') {
            const bye = S.birds.get(S.byeId);
            if (bye) view.byeName = bye.name;
          }
        }

        if (S.phase === 'champion') {
          view.championId = S.champion;
          view.standings = standings();
          view.flock = Array.from(S.birds.values()).map(function (b) {
            return { id: b.id, name: b.name, call: b.call, owner: b.ownerName, out: b.out, hasAudio: !!b.audio };
          });
        }

        return view;
      },

      onEvent: function (playerId, type, payload) {
        if (S.dead) return;
        const data = payload || {};
        const bird = S.birds.get(playerId);

        switch (type) {
          case 'start': {
            if (S.phase !== 'intro') return;
            const host = ctx.hostId;
            const hostHere = playerIds().indexOf(host) !== -1;
            if (hostHere && playerId !== host) return;
            advance();
            return;
          }

          case 'skip': {
            if (playerId !== ctx.hostId) return;
            if (S.phase === 'intro' || S.phase === 'champion') return;
            advance();
            return;
          }

          case 'name': {
            if (!bird) return;
            if (S.phase !== 'name' && !(S.phase === 'sound' && !bird.name)) return;
            bird.name = clean(data.text, MAX_NAME_LEN);
            push();
            return;
          }

          case 'call': {
            if (!bird) return;
            if (S.phase !== 'sound' && S.phase !== 'draw') return;
            bird.call = clean(data.text, MAX_CALL_LEN).toUpperCase();
            push();
            return;
          }

          case 'audio': {
            if (!bird) return;
            if (S.phase !== 'sound' && S.phase !== 'draw') return;
            const a = typeof data.data === 'string' ? data.data : '';
            if (!a || a.length > MAX_AUDIO_CHARS) {
              banner(nameOf(playerId) + "'s recording was too big to carry.", 'bad');
              return;
            }
            bird.audio = a;
            push();
            return;
          }

          case 'art': {
            if (!bird) return;
            if (S.phase !== 'draw' && S.phase !== 'reveal') return;
            const body = typeof data.body === 'string' ? data.body : '';
            const wing = typeof data.wing === 'string' ? data.wing : '';
            if (body.length > MAX_IMG_CHARS || wing.length > MAX_IMG_CHARS) {
              banner(nameOf(playerId) + "'s drawing was too big to send.", 'bad');
              return;
            }
            if (body) bird.body = body;
            if (wing) bird.wing = wing;
            S.delivered.forEach(function (set) { set.delete(playerId); });
            push();
            return;
          }

          case 'ready': {
            if (S.phase !== 'name' && S.phase !== 'sound' && S.phase !== 'draw') return;
            if (!bird) return;
            S.done.add(playerId);
            if (creationRoundIsDone()) advance();
            else push();
            return;
          }

          case 'unready': {
            S.done.delete(playerId);
            push();
            return;
          }

          case 'vote': {
            if (S.phase !== 'vote' || !S.match) return;
            if (eligibleVoters().indexOf(playerId) === -1) return;
            const choice = data.choice === 'a' ? 'a' : (data.choice === 'b' ? 'b' : null);
            if (!choice) return;
            const target = choice === 'a' ? S.match.a : S.match.b;
            if (target === playerId) return; // no voting for your own bird
            S.match.votes[playerId] = choice;
            const eligible = eligibleVoters();
            const allIn = eligible.every(function (id) { return !!S.match.votes[id]; });
            if (allIn) resolveMatch();
            else push();
            return;
          }

          case 'art:got': {
            const got = Array.isArray(data.ids) ? data.ids : [];
            let set = S.delivered.get(playerId);
            if (!set) { set = new Set(); S.delivered.set(playerId, set); }
            got.forEach(function (id) { set.add(id); });
            schedulePush(150);
            return;
          }

          case 'art:need': {
            const ids = Array.isArray(data.ids) ? data.ids : [];
            const known = S.delivered.get(playerId);
            if (known) {
              if (ids.length) ids.forEach(function (id) { known.delete(id); });
              else known.clear();
            }
            schedulePush(150);
            return;
          }

          case 'end': {
            if (S.phase !== 'champion') return;
            if (playerId !== ctx.hostId && playerIds().indexOf(ctx.hostId) !== -1) return;
            doFinish();
            return;
          }

          default:
            return;
        }
      },

      onJoin: function (playerId) {
        if (S.phase === 'name') makeBird(playerId);
        const b = S.birds.get(playerId);
        if (b) b.ownerName = nameOf(playerId);
        S.delivered.delete(playerId); // fresh client: re-send any art it needs
        push();
      },

      onLeave: function (playerId) {
        // The bird stays in the bracket — it has already been made.
        S.done.delete(playerId);
        if (S.phase === 'vote' && S.match) {
          delete S.match.votes[playerId];
          const eligible = eligibleVoters();
          if (eligible.length && eligible.every(function (id) { return !!S.match.votes[id]; })) {
            resolveMatch();
            return;
          }
        }
        push();
      },

      dispose: function () {
        S.dead = true;
        if (S.heartbeat) clearInterval(S.heartbeat);
        if (S.pushTimer) clearTimeout(S.pushTimer);
        S.heartbeat = null;
        S.pushTimer = null;
        S.birds.clear();
        S.delivered.clear();
      },
    };
  },
};
