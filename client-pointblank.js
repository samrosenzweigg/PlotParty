/* Point Blank — Bingo Bango mini-game (client) */
(function () {
  'use strict';

  var CSS = [
    '.pb{--wall:#E8EBEE;--ink:#1D2733;--hi:#FFD23F;--siren:#E0412B;--mug:#3A6EA5;color:var(--ink);font:inherit;max-width:560px;margin:0 auto;padding:12px 14px 28px;display:flex;flex-direction:column;gap:14px}',
    '.pb [hidden]{display:none !important}',
    '.pb-top{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:14px}',
    '.pb-timer{font-weight:800;font-variant-numeric:tabular-nums;font-size:20px}',
    '.pb-timer.low{color:var(--siren)}',
    '.pb-sec{display:flex;flex-direction:column;gap:12px}',
    '.pb-who{display:flex;align-items:center;gap:12px;font-size:22px;font-weight:800}',
    '.pb-who .pb-face{width:56px;height:56px}',
    '.pb-face{width:40px;height:40px;border-radius:50%;overflow:hidden;flex:none;display:flex;align-items:center;justify-content:center;background:var(--mug);color:#fff;font-weight:800}',
    '.pb-face>*{width:100%;height:100%}',
    '.pb-stem{font-size:26px;line-height:1.15;font-weight:800;letter-spacing:-.01em}',
    '.pb-stem::after{content:"\\2026"}',
    '.pb textarea{width:100%;box-sizing:border-box;min-height:96px;font:inherit;font-size:20px;padding:12px;border:3px solid var(--ink);border-radius:6px;background:#fff;color:var(--ink);resize:none}',
    '.pb textarea:focus{outline:4px solid var(--hi)}',
    '.pb-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
    '.pb-count{margin-left:auto;font-size:13px;opacity:.7;font-variant-numeric:tabular-nums}',
    '.pb button{font:inherit;font-weight:700;font-size:17px;padding:12px 16px;border-radius:6px;border:3px solid var(--ink);background:#fff;color:var(--ink);-webkit-tap-highlight-color:transparent}',
    '.pb button.go{background:var(--ink);color:#fff}',
    '.pb button.alt{border-color:transparent;background:transparent;text-decoration:underline;padding:8px 4px}',
    '.pb button:disabled{opacity:.4}',
    '.pb button:focus-visible{outline:4px solid var(--hi)}',
    '.pb-small{font-size:14px;opacity:.75}',
    '.pb-card{background:#fff;border:3px solid var(--ink);border-radius:6px;padding:16px;font-size:24px;line-height:1.2;font-weight:800}',
    '.pb-card span{font-weight:500}',
    '.pb-aim{position:relative;background:var(--ink);color:#fff;border-radius:6px;height:300px;overflow:hidden;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;',
    'background-image:repeating-linear-gradient(to bottom,rgba(255,255,255,.14) 0 2px,transparent 2px 30px)}',
    '.pb-arrow{width:150px;height:150px;transition:transform .08s linear}',
    '.pb-arrow path{fill:#5b6675}',
    '.pb-aim.on .pb-arrow path{fill:var(--hi)}',
    '.pb-aimname{font-size:26px;font-weight:800;display:flex;align-items:center;gap:10px;min-height:44px}',
    '.pb-hold{position:absolute;left:0;bottom:0;height:8px;background:var(--hi);width:0}',
    '.pb-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(88px,1fr));gap:8px}',
    '.pb-grid button{display:flex;flex-direction:column;align-items:center;gap:6px;padding:10px 6px;font-size:14px}',
    '.pb-grid button.sel{background:var(--hi)}',
    '.pb-tally{display:flex;flex-direction:column;gap:6px}',
    '.pb-tally div{display:flex;align-items:center;gap:8px;font-weight:700}',
    '.pb-tally .hit{background:var(--hi);border-radius:6px;padding:4px 6px}',
    '.pb-tally .pb-face{width:28px;height:28px;font-size:12px}',
    '.pb-big{font-size:34px;font-weight:800;line-height:1}',
    '.pb-score{display:flex;align-items:center;gap:10px;font-size:18px;font-weight:700}',
    '.pb-score b{margin-left:auto;font-variant-numeric:tabular-nums}',
    '@media (prefers-reduced-motion:reduce){.pb-arrow{transition:none}}'
  ].join('\n');

  var LS_CAL = 'pb-calib', LS_DRAFT = 'pb-draft-';
  var HOLD_MS = 1200, AIM_TOL = 30;

  var root, api, view, els = {}, tickId = null, rafId = null;
  var heading = null, lastOri = 0, oriOn = false;
  var calib = load(LS_CAL) || {}, calDraft = {}, calIdx = 0, lastPhase = null, lastRound = 0;
  var hold = { id: null, since: 0 }, sentVote = null, voteCardId = null, writeCardId = null, endArmed = 0;

  function load(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function drop(k) { try { localStorage.removeItem(k); } catch (e) {} }

  function h(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function meId() { return api && api.me && typeof api.me === 'object' ? api.me.id : api && api.me; }
  function nameOf(id) { var p = api.player(id); return (p && p.name) || 'Someone'; }
  function face(id) {
    var wrap = h('div', 'pb-face'), p = api.player(id), el = null;
    try { if (p && api.faceEl) el = api.faceEl(p); } catch (e) {}
    if (el) wrap.appendChild(el); else wrap.textContent = (nameOf(id)[0] || '?').toUpperCase();
    return wrap;
  }
  function send(type, payload) {
    var s;
    try { s = JSON.stringify(payload || {}); } catch (e) { return; }
    if (s.length > 1900000) { api.banner('That’s too big to send.', 'warn'); return; }
    api.send(type, payload || {});
  }
  function sd(a, b) { return ((a - b + 540) % 360) - 180; }
  function others() { var me = meId(); return (view.present || []).filter(function (id) { return id !== me; }); }
  function liveHeading() { return heading != null && Date.now() - lastOri < 1500; }

  // ---------- orientation ----------
  function onOri(e) {
    var hd = null;
    if (typeof e.webkitCompassHeading === 'number' && !isNaN(e.webkitCompassHeading)) hd = e.webkitCompassHeading;
    else if (e.absolute === true && e.alpha != null) hd = (360 - e.alpha) % 360;
    if (hd == null) return;
    heading = heading == null ? hd : (heading + sd(hd, heading) * 0.35 + 360) % 360;
    lastOri = Date.now();
  }
  function enableOri() {
    if (oriOn) return Promise.resolve(true);
    var D = window.DeviceOrientationEvent;
    var ask = D && typeof D.requestPermission === 'function' ? D.requestPermission() : Promise.resolve('granted');
    return ask.then(function (r) {
      if (r !== 'granted') throw new Error('denied');
      window.addEventListener('deviceorientation', onOri);
      window.addEventListener('deviceorientationabsolute', onOri);
      oriOn = true;
      return true;
    }).catch(function () {
      api.banner('Motion access is off — tap faces to vote instead.', 'warn');
      return false;
    });
  }

  // ---------- build ----------
  function build() {
    root = h('div', 'pb');
    var top = h('div', 'pb-top');
    els.round = h('span');
    els.timer = h('span', 'pb-timer');
    var hostBox = h('span', 'pb-row');
    els.skip = h('button', 'alt', 'Skip ahead');
    els.skip.onclick = function () { send('advance'); };
    els.endBtn = h('button', 'alt', 'End game');
    els.endBtn.onclick = function () {
      if (Date.now() - endArmed < 3000) { send('finish'); return; }
      endArmed = Date.now(); els.endBtn.textContent = 'Tap again to end';
      setTimeout(function () { els.endBtn.textContent = 'End game'; }, 3000);
    };
    hostBox.append(els.skip, els.endBtn);
    top.append(els.round, els.timer, hostBox);
    els.host = hostBox;
    root.appendChild(top);

    // write
    var w = els.write = h('section', 'pb-sec');
    els.wProg = h('div', 'pb-small');
    els.wWho = h('div', 'pb-who');
    els.wStem = h('div', 'pb-stem');
    els.wText = h('textarea');
    els.wText.setAttribute('placeholder', 'Finish it so everyone points at them');
    els.wText.oninput = function () {
      if (writeCardId) save(LS_DRAFT + writeCardId, els.wText.value);
      els.wCount.textContent = els.wText.value.length + '/' + (view.maxText || 110);
    };
    els.wCount = h('span', 'pb-count');
    els.wSubmit = h('button', 'go', 'Lock it in');
    els.wSubmit.onclick = function () {
      var t = els.wText.value.trim();
      if (!t) { els.wText.focus(); return; }
      els.wSubmit.disabled = true;
      send('write', { cardId: writeCardId, text: t });
      drop(LS_DRAFT + writeCardId);
    };
    els.wReroll = h('button', 'alt', 'Swap prompt');
    els.wReroll.onclick = function () { send('reroll', { cardId: writeCardId }); };
    var wRow = h('div', 'pb-row'); wRow.append(els.wSubmit, els.wReroll, els.wCount);
    els.wForm = h('div', 'pb-sec'); els.wForm.append(els.wWho, els.wStem, els.wText, wRow);
    els.wDone = h('div', 'pb-sec');
    w.append(els.wProg, els.wForm, els.wDone);

    // calibrate
    var c = els.cal = h('section', 'pb-sec');
    els.cBody = h('div', 'pb-sec');
    c.append(els.cBody);

    // vote
    var v = els.vote = h('section', 'pb-sec');
    els.vCard = h('div', 'pb-card');
    els.vMeta = h('div', 'pb-small');
    els.vWriter = h('div', 'pb-big', 'This one’s yours. Poker face.');
    els.aim = h('div', 'pb-aim');
    els.aim.innerHTML = '<svg class="pb-arrow" viewBox="0 0 100 100" aria-hidden="true"><path d="M50 4 L90 50 L64 50 L64 96 L36 96 L36 50 L10 50 Z"/></svg>';
    els.arrow = els.aim.firstChild;
    els.aimName = h('div', 'pb-aimname');
    els.holdBar = h('div', 'pb-hold');
    els.aim.append(els.aimName, els.holdBar);
    els.aimSetup = h('button', null, 'Point to vote');
    els.aimSetup.onclick = function () { enableOri(); };
    els.vStatus = h('div', 'pb-small');
    els.vGridLabel = h('div', 'pb-small', 'Or tap a face:');
    els.vGrid = h('div', 'pb-grid');
    v.append(els.vCard, els.vMeta, els.vWriter, els.aim, els.aimSetup, els.vStatus, els.vGridLabel, els.vGrid);

    // reveal
    els.rev = h('section', 'pb-sec');
    // end
    els.end = h('section', 'pb-sec');

    root.append(w, c, v, els.rev, els.end);
  }

  function promptText(card) {
    var d = h('div', 'pb-card');
    d.append(document.createTextNode(card.stem + '… '));
    d.append(h('span', null, card.text));
    return d;
  }

  // ---------- phases ----------
  function renderWrite() {
    var card = view.card;
    els.wProg.textContent = card ? 'Prompt ' + (view.done + 1) + ' of ' + view.total : '';
    els.wForm.hidden = !card;
    els.wDone.hidden = !!card;
    if (card) {
      if (card.id !== writeCardId) {
        writeCardId = card.id;
        els.wText.value = load(LS_DRAFT + card.id) || '';
        els.wSubmit.disabled = false;
      }
      els.wText.maxLength = view.maxText || 110;
      els.wCount.textContent = els.wText.value.length + '/' + (view.maxText || 110);
      els.wWho.textContent = '';
      els.wWho.append(face(card.target), h('span', null, nameOf(card.target)));
      els.wStem.textContent = card.stem;
      els.wReroll.hidden = !card.canReroll;
    } else {
      writeCardId = null;
      els.wDone.textContent = '';
      els.wDone.append(h('div', 'pb-big', 'All done.'),
        h('div', 'pb-small', view.waitingOn ? 'Waiting on ' + view.waitingOn + ' more.' : 'Moving on…'));
    }
  }

  function renderCal() {
    var b = els.cBody, me = meId(), list = others();
    b.textContent = '';
    if ((view.calibrated || []).indexOf(me) >= 0) {
      var waiting = (view.present || []).filter(function (id) { return view.calibrated.indexOf(id) < 0; }).length;
      b.append(h('div', 'pb-big', 'Ready to aim.'),
        h('div', 'pb-small', waiting ? 'Waiting on ' + waiting + ' to set up.' : 'Starting…'));
      return;
    }
    b.append(h('div', 'pb-big', 'Voting is by pointing.'),
      h('div', 'pb-small', 'Stay in your seat and hold your phone upright. Point the top of it at each person when asked.'));
    var saved = list.every(function (id) { return calib[id] != null; });
    if (!oriOn) {
      var go = h('button', 'go', 'Start setup');
      go.onclick = function () { enableOri().then(function (ok) { if (ok) renderCal(); }); };
      b.append(go);
      if (saved) {
        var same = h('button', null, 'Same seats as last time');
        same.onclick = function () { enableOri().then(function (ok) { if (ok) send('calibrated', { mode: 'point' }); }); };
        b.append(same);
      }
    } else if (calIdx < list.length) {
      var id = list[calIdx];
      var who = h('div', 'pb-who'); who.append(face(id), h('span', null, nameOf(id)));
      var set = h('button', 'go', 'Aimed at ' + nameOf(id));
      set.onclick = function () {
        if (!liveHeading()) { api.banner('No compass reading yet — move your phone a little and try again.', 'warn'); return; }
        calDraft[id] = heading; calIdx += 1;
        if (calIdx >= list.length) {
          Object.keys(calDraft).forEach(function (k) { calib[k] = calDraft[k]; });
          save(LS_CAL, calib);
          send('calibrated', { mode: 'point' });
        }
        renderCal();
      };
      b.append(h('div', 'pb-small', 'Person ' + (calIdx + 1) + ' of ' + list.length + '. Point at'), who, set);
      if (saved) {
        var same2 = h('button', null, 'Same seats as last time');
        same2.onclick = function () { send('calibrated', { mode: 'point' }); };
        b.append(same2);
      }
    }
    var tap = h('button', 'alt', 'Skip — I’ll tap faces to vote');
    tap.onclick = function () { send('calibrated', { mode: 'tap' }); };
    b.append(tap);
  }

  function renderVote() {
    var me = meId(), card = view.card;
    if (card.id !== voteCardId) { voteCardId = card.id; sentVote = null; hold = { id: null, since: 0 }; }
    els.vCard.replaceWith(els.vCard = promptText(card));
    els.vMeta.textContent = view.left ? view.left + ' more after this' : 'Last one';
    var writer = !!view.amWriter;
    els.vWriter.hidden = !writer;
    els.aim.hidden = writer || !oriOn;
    els.aimSetup.hidden = writer || oriOn || !others().some(function (id) { return calib[id] != null; });
    els.vGridLabel.hidden = els.vGrid.hidden = writer;
    els.vStatus.textContent = (view.myVote ? 'You picked ' + (view.myVote === me ? 'yourself' : nameOf(view.myVote)) + '. ' : '') +
      view.votedCount + ' of ' + view.voterCount + ' voted';
    els.vGrid.textContent = '';
    if (!writer) {
      others().concat([me]).forEach(function (id) {
        var btn = h('button', view.myVote === id ? 'sel' : null);
        btn.append(face(id), h('span', null, id === me ? 'Me' : nameOf(id)));
        btn.onclick = function () { sentVote = id; send('vote', { target: id }); };
        els.vGrid.append(btn);
      });
    }
  }

  function aimLoop() {
    rafId = requestAnimationFrame(aimLoop);
    if (!view || view.phase !== 'vote' || view.amWriter || !oriOn || els.aim.hidden) return;
    var cands = others().filter(function (id) { return calib[id] != null; });
    if (!liveHeading() || !cands.length) {
      els.aim.classList.remove('on');
      els.aimName.textContent = cands.length ? 'Waiting for compass…' : 'No seats set — tap a face below';
      els.holdBar.style.width = '0';
      return;
    }
    var best = null, bestD = 999;
    cands.forEach(function (id) { var d = sd(calib[id], heading); if (Math.abs(d) < Math.abs(bestD)) { bestD = d; best = id; } });
    els.arrow.style.transform = 'rotate(' + bestD.toFixed(1) + 'deg)';
    var on = Math.abs(bestD) <= AIM_TOL ? best : null;
    els.aim.classList.toggle('on', !!on);
    var now = performance.now();
    if (on) {
      if (hold.id !== on) { hold = { id: on, since: now }; els.aimName.textContent = ''; els.aimName.append(face(on), h('span', null, nameOf(on))); }
      var p = Math.min(1, (now - hold.since) / HOLD_MS);
      els.holdBar.style.width = (p * 100) + '%';
      if (p >= 1 && sentVote !== on && view.myVote !== on) {
        sentVote = on;
        send('vote', { target: on });
        if (navigator.vibrate) navigator.vibrate(40);
      }
    } else {
      if (hold.id !== null) { hold = { id: null, since: 0 }; els.aimName.textContent = 'Keep turning'; }
      els.holdBar.style.width = '0';
    }
  }

  function renderReveal() {
    var r = els.rev, c = view.card, me = meId();
    r.textContent = '';
    r.append(promptText(c));
    var about = h('div', 'pb-who'); about.append(face(c.target), h('span', null, 'It was ' + (c.target === me ? 'you' : nameOf(c.target))));
    var by = h('div', 'pb-score'); by.append(face(c.writer), h('span', null, 'Written by ' + (c.writer === me ? 'you' : nameOf(c.writer))), h('b', null, '+' + view.earned));
    r.append(about, by);
    var counts = {};
    Object.keys(view.votes || {}).forEach(function (v) { var t = view.votes[v]; (counts[t] = counts[t] || []).push(v); });
    var tally = h('div', 'pb-tally');
    Object.keys(counts).sort(function (a, b) { return counts[b].length - counts[a].length; }).forEach(function (t) {
      var row = h('div', t === c.target ? 'hit' : null);
      row.append(face(t), h('span', null, nameOf(t) + ' ×' + counts[t].length + ' '));
      counts[t].forEach(function (v) { row.append(face(v)); });
      tally.append(row);
    });
    if (!Object.keys(counts).length) tally.append(h('div', 'pb-small', 'Nobody voted.'));
    r.append(tally);
    if (view.isHost) { var nx = h('button', 'go', view.left ? 'Next card' : 'See scores'); nx.onclick = function () { send('advance'); }; r.append(nx); }
  }

  function renderEnd() {
    var e = els.end, me = meId();
    e.textContent = '';
    e.append(h('div', 'pb-big', 'Round ' + view.round + ' done.'));
    Object.keys(view.scores || {}).sort(function (a, b) { return view.scores[b] - view.scores[a]; }).forEach(function (id) {
      var row = h('div', 'pb-score'); row.append(face(id), h('span', null, id === me ? 'You' : nameOf(id)), h('b', null, String(view.scores[id])));
      e.append(row);
    });
    if (view.isHost) {
      var row2 = h('div', 'pb-row');
      var again = h('button', null, 'Another round'); again.disabled = !view.canAgain; again.onclick = function () { send('again'); };
      var fin = h('button', 'go', 'Finish game'); fin.onclick = function () { send('finish'); };
      row2.append(fin, again); e.append(row2);
      if (!view.canAgain) e.append(h('div', 'pb-small', 'Every prompt has been used.'));
    } else e.append(h('div', 'pb-small', 'Waiting for the host to play on or finish.'));
  }

  function tick() {
    if (!view) return;
    var ms = view.deadline ? view.deadline - api.serverNow() : 0;
    els.timer.hidden = !view.deadline;
    var s = Math.max(0, Math.ceil(ms / 1000));
    els.timer.textContent = Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
    els.timer.classList.toggle('low', s <= 10);
  }

  window.BingoBango.registerGame({
    id: 'pointblank',
    mount: function (container, a) {
      api = a;
      if (!document.getElementById('pb-style')) { var st = document.createElement('style'); st.id = 'pb-style'; st.textContent = CSS; document.head.appendChild(st); }
      build();
      container.appendChild(root);
      tickId = setInterval(tick, 250);
      rafId = requestAnimationFrame(aimLoop);
    },
    render: function (v, a) {
      if (a) api = a;
      view = v || {};
      if (view.phase !== lastPhase || view.round !== lastRound) {
        if (view.phase === 'calibrate') { calIdx = 0; calDraft = {}; }
        lastPhase = view.phase; lastRound = view.round;
      }
      els.round.textContent = 'Round ' + (view.round || 1);
      els.host.hidden = !view.isHost;
      els.skip.hidden = view.phase === 'end' || view.phase === 'reveal';
      els.write.hidden = view.phase !== 'write';
      els.cal.hidden = view.phase !== 'calibrate';
      els.vote.hidden = view.phase !== 'vote';
      els.rev.hidden = view.phase !== 'reveal';
      els.end.hidden = view.phase !== 'end';
      if (view.phase === 'write') renderWrite();
      else if (view.phase === 'calibrate') renderCal();
      else if (view.phase === 'vote') renderVote();
      else if (view.phase === 'reveal') renderReveal();
      else if (view.phase === 'end') renderEnd();
      tick();
    },
    unmount: function () {
      clearInterval(tickId); tickId = null;
      if (rafId) cancelAnimationFrame(rafId); rafId = null;
      window.removeEventListener('deviceorientation', onOri);
      window.removeEventListener('deviceorientationabsolute', onOri);
      oriOn = false;
      if (root && root.parentNode) root.parentNode.removeChild(root);
      root = null; view = null; els = {}; writeCardId = null; voteCardId = null; lastPhase = null;
    }
  });
})();
