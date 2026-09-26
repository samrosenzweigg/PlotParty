/* Point Blank \u2014 Bingo Bango mini-game (client) */
(function () {
  'use strict';

  var CSS = [
    // Kraft-cardboard table with paper cards taped on. Self-contained colours so contrast
    // never depends on the shell's theme.
    '.pb{--kraft:#C9A06C;--kraft-dk:#A97E4B;--paper:#FFFBF0;--ink:#2A1E14;--ink2:#4A3726;--hi:#FFD23F;--red:#D2382A;--board:#3A2A1C;',
    'color:var(--ink);max-width:560px;margin:0 auto;padding:14px 14px 32px;display:flex;flex-direction:column;gap:16px;border-radius:10px;',
    'font-family:-apple-system,system-ui,sans-serif;background-color:var(--kraft);',
    'background-image:radial-gradient(rgba(90,60,30,.18) 1px,transparent 1.5px),radial-gradient(rgba(255,240,210,.18) 1px,transparent 1.5px),repeating-linear-gradient(90deg,rgba(0,0,0,.035) 0 2px,transparent 2px 7px);',
    'background-size:9px 9px,13px 13px,auto;background-position:0 0,4px 6px,0 0;box-shadow:inset 0 0 0 3px var(--kraft-dk)}',
    '.pb [hidden]{display:none !important}',
    '.pb-hand{font-family:"Permanent Marker","Marker Felt","Comic Sans MS",cursive;font-weight:400;letter-spacing:.01em}',
    '.pb-top{display:flex;align-items:center;gap:10px;font-size:15px;font-weight:700;white-space:nowrap}',
    '.pb-top>.pb-row{margin-left:auto;flex-wrap:nowrap;gap:4px}',
    '.pb-top button.alt{font-size:14px;padding:6px 4px}',
    '.pb-timer{font-family:"Permanent Marker","Marker Felt",cursive;font-size:24px;background:var(--paper);padding:2px 12px;border-radius:4px;transform:rotate(2deg);box-shadow:0 2px 0 var(--kraft-dk);font-variant-numeric:tabular-nums}',
    '.pb-timer.low{color:#fff;background:var(--red);animation:pb-pulse .6s ease-in-out infinite alternate}',
    '.pb-sec{display:flex;flex-direction:column;gap:14px}',
    '.pb-paper{position:relative;background:var(--paper);border-radius:3px;padding:18px 16px 16px;box-shadow:0 1px 0 #e6dcc4,0 6px 14px rgba(60,35,10,.35);transform:rotate(-1deg)}',
    '.pb-paper::before{content:"";position:absolute;top:-11px;left:50%;width:84px;height:22px;margin-left:-42px;background:rgba(255,240,180,.75);transform:rotate(-3deg);box-shadow:0 1px 2px rgba(0,0,0,.15)}',
    '.pb-paper.tilt{transform:rotate(1.2deg)}',
    '.pb-who{display:flex;align-items:center;gap:12px;font-size:26px}',
    '.pb-who .pb-face{width:60px;height:60px}',
    '.pb-face{width:42px;height:42px;border-radius:50%;overflow:hidden;flex:none;display:flex;align-items:center;justify-content:center;background:var(--board);color:var(--paper);font-weight:800;border:3px solid var(--paper);box-shadow:0 2px 4px rgba(0,0,0,.3)}',
    '.pb-face>*{width:100%;height:100%;object-fit:cover}',
    '.pb-stem{font-family:"Permanent Marker","Marker Felt",cursive;font-size:30px;line-height:1.15;color:var(--ink)}',
    '.pb-stem::after{content:"\\2026"}',
    '.pb textarea{width:100%;box-sizing:border-box;min-height:100px;font:600 21px/1.35 -apple-system,system-ui,sans-serif;padding:10px 12px;border:0;border-radius:2px;color:var(--ink);resize:none;',
    'background:#fff repeating-linear-gradient(to bottom,transparent 0 27px,#B9D3EA 27px 28px);background-position:0 10px;box-shadow:inset 0 0 0 2px var(--ink2)}',
    '.pb textarea:focus{outline:4px solid var(--hi);outline-offset:2px}',
    '.pb-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}',
    '.pb-count{margin-left:auto;font-size:14px;font-weight:700;color:var(--ink2);font-variant-numeric:tabular-nums}',
    '.pb button{font:800 18px -apple-system,system-ui,sans-serif;padding:13px 18px;border-radius:6px;border:3px solid var(--ink);background:var(--paper);color:var(--ink);box-shadow:0 4px 0 var(--ink);-webkit-tap-highlight-color:transparent;transition:transform .08s,box-shadow .08s;cursor:pointer}',
    '.pb button:active{transform:translateY(4px);box-shadow:0 0 0 var(--ink)}',
    '.pb button.go{background:var(--red);color:#fff}',
    '.pb button.alt{border:0;background:transparent;box-shadow:none;text-decoration:underline;padding:8px 4px;font-size:16px;color:var(--ink)}',
    '.pb button:disabled{opacity:.45}',
    '.pb button:focus-visible{outline:4px solid var(--hi);outline-offset:2px}',
    '.pb-small{font-size:15px;font-weight:600;color:var(--ink2)}',
    '.pb-top .pb-small,.pb>.pb-sec>.pb-small{color:var(--ink)}',
    '.pb-card{font-size:25px;line-height:1.25;font-weight:800}',
    '.pb-card .pb-stemtxt{font-family:"Permanent Marker","Marker Felt",cursive;font-weight:400;display:block;margin-bottom:4px}',
    '.pb-card span:last-child{font-weight:700}',
    '.pb-aim{position:relative;background:var(--board);color:var(--paper);border-radius:6px;height:310px;overflow:hidden;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;',
    'background-image:repeating-linear-gradient(to bottom,rgba(255,251,240,.13) 0 2px,transparent 2px 30px);box-shadow:inset 0 0 0 4px #2A1D12,0 6px 14px rgba(60,35,10,.35)}',
    '.pb-arrow{width:160px;height:160px;transition:transform .09s linear;filter:drop-shadow(0 6px 0 rgba(0,0,0,.35))}',
    '.pb-arrow path{fill:#8C7A66;stroke:var(--paper);stroke-width:3;stroke-linejoin:round}',
    '.pb-aim.on .pb-arrow path{fill:var(--hi)}',
    '.pb-aim.on .pb-aimname{animation:pb-pop .25s ease-out}',
    '.pb-aimname{font-family:"Permanent Marker","Marker Felt",cursive;font-size:28px;display:flex;align-items:center;gap:10px;min-height:48px;color:var(--paper)}',
    '.pb-hold{position:absolute;left:0;bottom:0;height:10px;background:var(--hi);width:0}',
    '.pb-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:10px}',
    '.pb-grid button{display:flex;flex-direction:column;align-items:center;gap:6px;padding:10px 6px;font-size:15px}',
    '.pb-grid button:nth-child(odd){transform:rotate(-1.5deg)}.pb-grid button:nth-child(even){transform:rotate(1.5deg)}',
    '.pb-grid button.sel{background:var(--hi);animation:pb-pop .3s ease-out}',
    '.pb-tally{display:flex;flex-direction:column;gap:8px}',
    '.pb-tally>div{display:flex;align-items:center;gap:8px;font-weight:800;background:var(--paper);border-radius:4px;padding:6px 8px;box-shadow:0 2px 0 var(--kraft-dk)}',
    '.pb-tally .hit{background:var(--hi)}',
    '.pb-tally .pb-face{width:30px;height:30px;font-size:12px;border-width:2px}',
    '.pb-big{font-family:"Permanent Marker","Marker Felt",cursive;font-size:36px;line-height:1.05;color:var(--ink)}',
    '.pb-score{display:flex;align-items:center;gap:10px;font-size:19px;font-weight:800;background:var(--paper);border-radius:4px;padding:8px 10px;box-shadow:0 3px 0 var(--kraft-dk)}',
    '.pb-score b{margin-left:auto;font-family:"Permanent Marker","Marker Felt",cursive;font-weight:400;font-size:24px;font-variant-numeric:tabular-nums}',
    '.pb-score:first-of-type{background:var(--hi)}',
    '.pb-stamp{position:absolute;right:10px;top:50%;font-family:"Permanent Marker","Marker Felt",cursive;font-size:30px;color:var(--red);border:4px solid var(--red);border-radius:6px;padding:0 10px;transform:translateY(-50%) rotate(-12deg);opacity:.9;animation:pb-stamp .45s cubic-bezier(.2,1.6,.4,1) both;animation-delay:.35s;background:rgba(255,251,240,.6)}',
    '.pb-rel{position:relative}',
    '.pb-deal{animation:pb-deal .45s cubic-bezier(.2,1.3,.4,1) both}',
    '.pb-flip{animation:pb-flip .4s ease-out}',
    '.pb-rise>*{animation:pb-rise .4s ease-out both}',
    '.pb-rise>*:nth-child(2){animation-delay:.08s}.pb-rise>*:nth-child(3){animation-delay:.16s}.pb-rise>*:nth-child(4){animation-delay:.24s}.pb-rise>*:nth-child(5){animation-delay:.32s}.pb-rise>*:nth-child(n+6){animation-delay:.4s}',
    '@keyframes pb-deal{from{opacity:0;transform:translate(60px,-30px) rotate(12deg) scale(.9)}to{opacity:1}}',
    '@keyframes pb-flip{0%{transform:rotateX(0)}50%{transform:rotateX(90deg)}100%{transform:rotateX(0)}}',
    '@keyframes pb-pop{0%{transform:scale(.8)}60%{transform:scale(1.12)}100%{transform:scale(1)}}',
    '@keyframes pb-stamp{from{opacity:0;transform:translateY(-50%) rotate(-12deg) scale(2.6)}to{opacity:.9;transform:translateY(-50%) rotate(-12deg) scale(1)}}',
    '@keyframes pb-rise{from{opacity:0;transform:translateY(16px)}to{opacity:1}}',
    '@keyframes pb-pulse{to{transform:rotate(2deg) scale(1.1)}}',
    '@media (prefers-reduced-motion:reduce){.pb *,.pb *::before{animation:none !important;transition:none !important}}'
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
    if (s.length > 1900000) { api.banner('That\u2019s too big to send.', 'warn'); return; }
    api.send(type, payload || {});
  }
  function replay(el, cls) { if (!el) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
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
      api.banner('Motion access is off \u2014 tap faces to vote instead.', 'warn');
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
    els.wWho = h('div', 'pb-who pb-hand');
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
    els.wForm = h('div', 'pb-sec pb-paper'); els.wForm.append(els.wWho, els.wStem, els.wText, wRow);
    els.wDone = h('div', 'pb-sec pb-paper tilt');
    w.append(els.wProg, els.wForm, els.wDone);

    // calibrate
    var c = els.cal = h('section', 'pb-sec');
    els.cBody = h('div', 'pb-sec');
    c.append(els.cBody);

    // vote
    var v = els.vote = h('section', 'pb-sec');
    els.vCard = h('div', 'pb-card');
    els.vMeta = h('div', 'pb-small');
    els.vWriter = h('div', 'pb-big', 'This one\u2019s yours. Poker face.');
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
    var d = h('div', 'pb-card pb-paper');
    d.append(h('span', 'pb-stemtxt', card.stem + '\u2026'));
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
        replay(els.wForm, 'pb-deal');
      } else if (els.wStem.textContent && els.wStem.textContent !== card.stem) replay(els.wStem, 'pb-flip');
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
        h('div', 'pb-small', view.waitingOn ? 'Waiting on ' + view.waitingOn + ' more.' : 'Moving on\u2026'));
    }
  }

  function renderCal() {
    var b = els.cBody, me = meId(), list = others();
    b.textContent = '';
    b.className = 'pb-sec pb-paper';
    if ((view.calibrated || []).indexOf(me) >= 0) {
      var waiting = (view.present || []).filter(function (id) { return view.calibrated.indexOf(id) < 0; }).length;
      b.append(h('div', 'pb-big', 'Ready to aim.'),
        h('div', 'pb-small', waiting ? 'Waiting on ' + waiting + ' to set up.' : 'Starting\u2026'));
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
        if (!liveHeading()) { api.banner('No compass reading yet \u2014 move your phone a little and try again.', 'warn'); return; }
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
    var tap = h('button', 'alt', 'Skip \u2014 I\u2019ll tap faces to vote');
    tap.onclick = function () { send('calibrated', { mode: 'tap' }); };
    b.append(tap);
  }

  function renderVote() {
    var me = meId(), card = view.card;
    var fresh = card.id !== voteCardId;
    if (fresh) { voteCardId = card.id; sentVote = null; hold = { id: null, since: 0 }; }
    els.vCard.replaceWith(els.vCard = promptText(card));
    if (fresh) replay(els.vCard, 'pb-deal');
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
      els.aimName.textContent = cands.length ? 'Waiting for compass\u2026' : 'No seats set \u2014 tap a face below';
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
    var fresh = r.dataset.card !== c.id; r.dataset.card = c.id;
    r.textContent = '';
    r.classList.toggle('pb-rise', fresh);
    r.append(promptText(c));
    var about = h('div', 'pb-who pb-hand pb-paper tilt'); about.append(face(c.target), h('span', null, 'It was ' + (c.target === me ? 'you' : nameOf(c.target))));
    if (fresh) about.append(h('div', 'pb-stamp', 'GUILTY'));
    var by = h('div', 'pb-score'); by.append(face(c.writer), h('span', null, 'Written by ' + (c.writer === me ? 'you' : nameOf(c.writer))), h('b', null, '+' + view.earned));
    r.append(about, by);
    var counts = {};
    Object.keys(view.votes || {}).forEach(function (v) { var t = view.votes[v]; (counts[t] = counts[t] || []).push(v); });
    var tally = h('div', 'pb-tally');
    Object.keys(counts).sort(function (a, b) { return counts[b].length - counts[a].length; }).forEach(function (t) {
      var row = h('div', t === c.target ? 'hit' : null);
      row.append(face(t), h('span', null, nameOf(t) + ' \u00d7' + counts[t].length + ' '));
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
    e.classList.add('pb-rise');
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
      if (!document.getElementById('pb-font')) { var lf = document.createElement('link'); lf.id = 'pb-font'; lf.rel = 'stylesheet'; lf.href = 'https://fonts.googleapis.com/css2?family=Permanent+Marker&display=swap'; document.head.appendChild(lf); }
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
