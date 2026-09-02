/* ============================================================
   Plot Party — mini game module
   ------------------------------------------------------------
   The shell hands this file a ctx and gets back an instance.
   The instance owns its own state and its own secret-filtering.

   ctx.players   -> [{id,name,colour,avatar,connected}]
   ctx.hostId    -> playerId
   ctx.push()    -> re-broadcast state to everyone
   ctx.banner(t) -> top banner for everyone
   ctx.finish(s) -> end the game, s = {playerId: points}

   instance.viewFor(playerId)
   instance.onEvent(playerId, type, payload)
   instance.onJoin(playerId) / onLeave(playerId)
   instance.dispose()
   ============================================================ */

const PRESETS = [
  { top: 'Delicious', bottom: 'Disgusting', left: 'Cheap', right: 'Expensive' },
  { top: 'Overrated', bottom: 'Underrated', left: 'Old', right: 'New' },
  { top: 'Would defend in court', bottom: 'Indefensible', left: 'Quiet', right: 'Loud' },
  { top: 'Chaotic', bottom: 'Orderly', left: 'Evil', right: 'Good' },
  { top: 'Weekday', bottom: 'Weekend', left: 'Sober', right: 'Three drinks in' },
  { top: 'Impressive', bottom: 'Embarrassing', left: 'Cheap', right: 'Ruinous' },
];

const DEFAULT_COUNTDOWN = 45;
const MAX_SCORE = 1000;
const SCORE_RANGE = 0.7;      // guesses further than this from the target score nothing

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp01(n) {
  return Math.max(0, Math.min(1, Number(n) || 0));
}

module.exports = {
  id: 'plotparty',
  name: 'Plot Party',
  tagline: 'Argue about where things belong on a grid.',
  minPlayers: 2,

  create(ctx) {
    const preset = PRESETS[Math.floor(Math.random() * PRESETS.length)];

    const s = {
      mode: 'reveal',                 // live | reveal | clue
      axes: { ...preset },
      countdownSeconds: DEFAULT_COUNTDOWN,
      phase: 'submit',                // submit | place | reveal
      item: '',
      submitterId: null,
      secret: null,                   // clue mode target
      placements: {},                 // playerId -> {x,y}
      locked: {},                     // playerId -> true
      marks: [],                      // persistent board history
      endsAt: null,
      roundScores: {},
      average: null,
      outlierId: null,
      totals: {},
      turnIndex: 0,
      roundNo: 0,
    };

    let timer = null;

    /* ---------- helpers ------------------------------------------------- */

    function live() {
      return ctx.players.filter(p => p.connected);
    }

    function guessers() {
      return live().filter(p => !(s.mode === 'clue' && p.id === s.submitterId));
    }

    function clearTimer() {
      if (timer) { clearTimeout(timer); timer = null; }
      s.endsAt = null;
    }

    function nextSubmitter() {
      const people = live();
      if (!people.length) return null;
      s.turnIndex = s.turnIndex % people.length;
      const pick = people[s.turnIndex];
      return pick ? pick.id : null;
    }

    function beginRound() {
      clearTimer();
      s.phase = 'submit';
      s.item = '';
      s.placements = {};
      s.locked = {};
      s.roundScores = {};
      s.average = null;
      s.outlierId = null;
      s.submitterId = nextSubmitter();
      s.secret = s.mode === 'clue'
        ? { x: 0.1 + Math.random() * 0.8, y: 0.1 + Math.random() * 0.8 }
        : null;
      ctx.push();
    }

    function beginPlacing() {
      s.phase = 'place';
      if (s.mode === 'reveal' || s.mode === 'clue') {
        s.endsAt = Date.now() + s.countdownSeconds * 1000;
        timer = setTimeout(reveal, s.countdownSeconds * 1000 + 200);
      }
      ctx.push();
    }

    function everyoneLocked() {
      const need = guessers();
      return need.length > 0 && need.every(p => s.locked[p.id]);
    }

    function reveal() {
      clearTimer();
      if (s.phase === 'reveal') return;
      s.phase = 'reveal';
      s.roundNo++;

      const dots = guessers()
        .filter(p => s.placements[p.id])
        .map(p => ({ id: p.id, ...s.placements[p.id] }));

      if (dots.length) {
        s.average = {
          x: dots.reduce((n, d) => n + d.x, 0) / dots.length,
          y: dots.reduce((n, d) => n + d.y, 0) / dots.length,
        };
      }

      if (s.mode === 'clue' && s.secret) {
        let sum = 0;
        dots.forEach(d => {
          const pts = Math.max(0, Math.round(
            MAX_SCORE * (1 - dist(d, s.secret) / SCORE_RANGE)));
          s.roundScores[d.id] = pts;
          s.totals[d.id] = (s.totals[d.id] || 0) + pts;
          sum += pts;
        });
        if (s.submitterId && dots.length) {
          // The clue giver lives or dies by how well they were understood.
          const pts = Math.round(sum / dots.length);
          s.roundScores[s.submitterId] = pts;
          s.totals[s.submitterId] = (s.totals[s.submitterId] || 0) + pts;
        }
      }

      // Whoever is furthest from everyone else gets named and shamed.
      if (dots.length > 2 && s.average) {
        let worst = null, worstD = -1;
        dots.forEach(d => {
          const dd = dist(d, s.average);
          if (dd > worstD) { worstD = dd; worst = d.id; }
        });
        s.outlierId = worst;
      }

      // Keep the round on the board so the grid fills up over the night.
      const marker = s.mode === 'clue' ? s.secret : s.average;
      if (marker && s.item) {
        s.marks.push({
          x: marker.x, y: marker.y,
          label: s.item,
          round: s.roundNo,
        });
        if (s.marks.length > 40) s.marks.shift();
      }

      ctx.push();
    }

    /* ---------- per-player view ----------------------------------------- */

    function viewFor(playerId) {
      const revealed = s.phase === 'reveal';
      const isSubmitter = playerId === s.submitterId;

      // Live mode shows every dot as it moves. The other two hide everything
      // that isn't yours until the reveal.
      let visible = {};
      if (revealed || s.mode === 'live') {
        visible = { ...s.placements };
        if (s.mode === 'clue' && !revealed) delete visible[s.submitterId];
      } else if (s.placements[playerId]) {
        visible = { [playerId]: s.placements[playerId] };
      }

      return {
        mode: s.mode,
        axes: s.axes,
        presets: PRESETS,
        countdownSeconds: s.countdownSeconds,
        phase: s.phase,
        item: s.item,
        submitterId: s.submitterId,
        isSubmitter,
        // Only the clue giver ever sees the target before the reveal.
        secret: (s.mode === 'clue' && (revealed || isSubmitter)) ? s.secret : null,
        placements: visible,
        locked: s.locked,
        marks: s.marks,
        endsAt: s.endsAt,
        roundScores: revealed ? s.roundScores : {},
        totals: s.totals,
        average: revealed ? s.average : null,
        outlierId: revealed ? s.outlierId : null,
        roundNo: s.roundNo,
        lockedCount: Object.keys(s.locked).length,
        needCount: guessers().length,
      };
    }

    /* ---------- events --------------------------------------------------- */

    function onEvent(playerId, type, payload) {
      const host = playerId === ctx.hostId;

      switch (type) {

        case 'setMode': {
          if (!host || s.phase !== 'submit') return;
          if (!['live', 'reveal', 'clue'].includes(payload)) return;
          s.mode = payload;
          s.totals = {};
          s.marks = [];
          ctx.banner(`Mode: ${payload === 'reveal' ? 'Countdown' : payload === 'clue' ? 'Clue giver' : 'Live'}`, 'info');
          beginRound();
          return;
        }

        case 'setAxes': {
          if (!host || !payload) return;
          ['top', 'bottom', 'left', 'right'].forEach(k => {
            if (typeof payload[k] === 'string') {
              s.axes[k] = payload[k].trim().slice(0, 24) || s.axes[k];
            }
          });
          ctx.push();
          return;
        }

        case 'setCountdown': {
          if (!host) return;
          const n = Number(payload);
          if (![15, 30, 45, 60, 90].includes(n)) return;
          s.countdownSeconds = n;
          ctx.push();
          return;
        }

        case 'clearMarks': {
          if (!host) return;
          s.marks = [];
          ctx.banner('Board wiped', 'warn');
          ctx.push();
          return;
        }

        case 'submitItem': {
          if (s.phase !== 'submit' || playerId !== s.submitterId) return;
          const text = String(payload || '').trim().slice(0, 60);
          if (!text) return;
          s.item = text;
          beginPlacing();
          return;
        }

        case 'place': {
          if (s.phase !== 'place') return;
          if (s.locked[playerId]) return;
          if (s.mode === 'clue' && playerId === s.submitterId) return;
          if (!payload) return;
          s.placements[playerId] = { x: clamp01(payload.x), y: clamp01(payload.y) };
          ctx.push();
          return;
        }

        case 'lockIn': {
          if (s.phase !== 'place' || !s.placements[playerId]) return;
          if (s.mode === 'clue' && playerId === s.submitterId) return;
          s.locked[playerId] = true;
          if (everyoneLocked()) reveal();
          else ctx.push();
          return;
        }

        case 'revealNow': {
          if (!host || s.phase !== 'place') return;
          reveal();
          return;
        }

        case 'nextRound': {
          if (s.phase !== 'reveal') return;
          if (!host && playerId !== s.submitterId) return;
          s.turnIndex++;
          beginRound();
          return;
        }

        case 'endGame': {
          if (!host) return;
          clearTimer();
          ctx.finish({ ...s.totals });
          return;
        }
      }
    }

    beginRound();

    return {
      viewFor,
      onEvent,
      onJoin() { ctx.push(); },
      onLeave(playerId) {
        // Don't strand the round on someone who closed their tab.
        if (s.phase === 'place' && everyoneLocked()) reveal();
        else if (s.phase === 'submit' && playerId === s.submitterId) beginRound();
        else ctx.push();
      },
      dispose() { clearTimer(); },
    };
  },
};
