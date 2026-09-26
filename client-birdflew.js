/* ------------------------------------------------------------------
   Bird Flew  —  a Bingo Bango mini-game (client half)
   File lives flat in the repo root as: client-birdflew.js
   ------------------------------------------------------------------ */

(function () {
  'use strict';

  var BB = window.BingoBango;
  if (!BB || typeof BB.registerGame !== 'function') return;

  /* ---------------- constants ---------------- */

  var BODY_W = 420, BODY_H = 420;
  var WING_W = 260, WING_H = 190;
  var MAX_IMG_CHARS = 300000;
  var MAX_AUDIO_BYTES = 480000;
  var REC_MS = 5000;

  var INK = [
    { id: 'ink', hex: '#1b2a30' },
    { id: 'rust', hex: '#c8542b' },
    { id: 'yolk', hex: '#f2b134' },
    { id: 'leaf', hex: '#3f8f5e' },
    { id: 'sky', hex: '#3d7ea6' },
    { id: 'plum', hex: '#8a4f7d' },
    { id: 'bone', hex: '#f6efe0' }
  ];

  var DEFAULT_BODY = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="420" height="420" viewBox="0 0 420 420">' +
    '<path d="M150 260c-30-18-44-52-36-86 9-38 45-64 86-64 44 0 78 27 88 62l38-16-26 34 30 10-34 12c-2 46-38 80-88 80-22 0-42-12-58-32z" fill="#2c4048"/>' +
    '<path d="M150 262c18 28 40 62 34 96 26-14 42-40 46-68z" fill="#22333a"/>' +
    '<circle cx="250" cy="150" r="7" fill="#f6efe0"/></svg>');

  var DEFAULT_WING = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="260" height="190" viewBox="0 0 260 190">' +
    '<path d="M246 96c-40 44-108 72-176 66-44-4-68-26-62-46 6-22 44-38 96-42 58-4 112 6 142 22z" fill="#38505a"/>' +
    '</svg>');

  /* ---------------- module state ---------------- */

  var api = null;
  var root = null;
  var view = null;
  var ticker = null;
  var sig = '';
  var urls = [];
  var artStore = {};        // birdId -> { body:Image, wing:Image, audio:String|null }
  var mountedBirds = [];    // { el, id }
  var lastArtAsk = 0;
  var pane = {};            // phase -> element
  var draw = null;
  var rec = null;
  var tileUrl = null;

  /* ---------------- small helpers ---------------- */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }

  function dataUrlToBlob(d) {
    var comma = d.indexOf(',');
    var meta = d.slice(0, comma);
    var mime = (meta.match(/data:([^;,]+)/) || [null, 'application/octet-stream'])[1];
    var body = d.slice(comma + 1);
    if (!/;base64/i.test(meta)) return new Blob([decodeURIComponent(body)], { type: mime });
    var bin = atob(body);
    var buf = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return new Blob([buf], { type: mime });
  }

  // Safari chokes on big data: URLs in img/audio src, so everything becomes an object URL.
  function objUrl(dataUrl) {
    if (!dataUrl) return null;
    if (dataUrl.indexOf('data:image/svg') === 0) return dataUrl;
    try {
      var u = URL.createObjectURL(dataUrlToBlob(dataUrl));
      urls.push(u);
      return u;
    } catch (e) { return dataUrl; }
  }

  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result)); };
      fr.onerror = function () { reject(new Error('read failed')); };
      fr.readAsDataURL(blob);
    });
  }

  function loadImg(src) {
    var img = new Image();
    img.decoding = 'async';
    img.src = src;
    return img;
  }

  function secsLeft() {
    if (!view || !view.endsAt) return null;
    var now = (api && api.serverNow) ? api.serverNow() : Date.now();
    return Math.max(0, Math.ceil((view.endsAt - now) / 1000));
  }

  function fracLeft(total) {
    if (!view || !view.endsAt) return 0;
    var now = (api && api.serverNow) ? api.serverNow() : Date.now();
    var left = Math.max(0, view.endsAt - now);
    return Math.max(0, Math.min(1, left / (total || 1)));
  }

  function faceFor(id) {
    try {
      var p = api.player(id);
      if (p && api.faceEl) {
        var f = api.faceEl(p);
        if (f) return f;
      }
      var initials = el('span', 'bf-initials', (p && p.name ? p.name : '?').slice(0, 1).toUpperCase());
      return initials;
    } catch (e) {
      return el('span', 'bf-initials', '?');
    }
  }

  function say(text, tone) {
    try { api.banner(text, tone || 'info'); } catch (e) { /* optional */ }
  }

  /* ---------------- art cache ---------------- */

  function ingestArt(list) {
    if (!list || !list.length) return false;
    var changed = false;
    var got = [];
    list.forEach(function (a) {
      if (!a || !a.id) return;
      got.push(a.id);
      artStore[a.id] = {
        body: loadImg(objUrl(a.body) || DEFAULT_BODY),
        wing: loadImg(objUrl(a.wing) || DEFAULT_WING),
        audio: a.audio ? objUrl(a.audio) : null,
        real: !!a.body
      };
      changed = true;
    });
    if (got.length) api.send('art:got', { ids: got });
    return changed;
  }

  function haveArt(id) { return !!artStore[id]; }

  /* ---------------- bird element ---------------- */

  function birdEl(id, opts) {
    opts = opts || {};
    var wrap = el('div', 'bf-bird' + (opts.small ? ' bf-bird-sm' : ''));
    var lw = el('div', 'bf-wingwrap bf-l');
    var ls = el('div', 'bf-wingspin');
    var li = el('img', 'bf-wingimg');
    ls.appendChild(li); lw.appendChild(ls);
    var rw = el('div', 'bf-wingwrap bf-r');
    var rs = el('div', 'bf-wingspin');
    var ri = el('img', 'bf-wingimg');
    rs.appendChild(ri); rw.appendChild(rs);
    var body = el('img', 'bf-bodyimg');
    wrap.appendChild(lw); wrap.appendChild(rw); wrap.appendChild(body);
    wrap.setAttribute('data-bird', id);
    mountedBirds.push({ el: wrap, id: id });
    hydrate(wrap, id);
    return wrap;
  }

  function hydrate(wrap, id) {
    var a = artStore[id];
    var body = wrap.querySelector('.bf-bodyimg');
    var wings = wrap.querySelectorAll('.bf-wingimg');
    var bSrc = a && a.body ? a.body.src : DEFAULT_BODY;
    var wSrc = a && a.wing ? a.wing.src : DEFAULT_WING;
    if (body.getAttribute('src') !== bSrc) body.setAttribute('src', bSrc);
    for (var i = 0; i < wings.length; i++) {
      if (wings[i].getAttribute('src') !== wSrc) wings[i].setAttribute('src', wSrc);
    }
    wrap.classList.toggle('bf-ghost', !(a && a.real));
  }

  function rehydrateAll() {
    mountedBirds = mountedBirds.filter(function (m) { return m.el.isConnected; });
    mountedBirds.forEach(function (m) { hydrate(m.el, m.id); });
  }

  function chaseMissingArt() {
    var missing = [];
    mountedBirds.forEach(function (m) {
      if (m.el.isConnected && !haveArt(m.id) && missing.indexOf(m.id) === -1) missing.push(m.id);
    });
    if (!missing.length) return;
    var now = Date.now();
    if (now - lastArtAsk < 2500) return;
    lastArtAsk = now;
    api.send('art:need', { ids: missing });
  }

  /* ---------------- audio ---------------- */

  var playing = null;
  function playCall(id, btn) {
    var a = artStore[id];
    if (!a || !a.audio) { say('That bird is silent.', 'info'); return; }
    try {
      if (playing) { playing.pause(); playing = null; }
      var audio = new Audio(a.audio);
      playing = audio;
      if (btn) {
        btn.classList.add('bf-playing');
        audio.onended = function () { btn.classList.remove('bf-playing'); };
      }
      audio.play().catch(function () { say('Safari blocked that. Tap again.', 'info'); });
    } catch (e) { /* ignore */ }
  }

  function callBtn(bird) {
    var b = el('button', 'bf-callbtn');
    b.type = 'button';
    b.appendChild(el('span', 'bf-callicon', '\u25B6'));
    b.appendChild(el('span', null, bird.hasAudio ? 'Hear it' : (bird.call ? bird.call : 'No call')));
    if (bird.hasAudio) {
      b.addEventListener('click', function (ev) { ev.stopPropagation(); playCall(bird.id, b); });
    } else {
      b.disabled = !bird.call;
      b.classList.add('bf-callbtn-text');
    }
    return b;
  }

  /* ---------------- the shell ---------------- */

  var CSS = [
    '#bf-root{--bf-ink:#0d2a30;--bf-ink2:#123b44;--bf-card:#16454f;--bf-bone:#f4ecdb;--bf-yolk:#f0b43c;--bf-rust:#d9603a;--bf-leaf:#79cf9a;--bf-flu:#b98cd6;',
    'color:var(--bf-bone);font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif;-webkit-text-size-adjust:100%;}',
    '#bf-root [hidden]{display:none !important;}',
    '#bf-root *{box-sizing:border-box;}',
    '.bf-pane{display:flex;flex-direction:column;gap:14px;padding:4px 0 28px;}',
    '.bf-display{font-family:"Avenir Next Condensed","Futura","Helvetica Neue",sans-serif;font-weight:700;letter-spacing:.01em;line-height:.95;margin:0;}',
    '.bf-h1{font-size:clamp(34px,11vw,56px);}',
    '.bf-h2{font-size:clamp(24px,7vw,34px);}',
    '.bf-sub{margin:0;font-size:15px;line-height:1.45;color:rgba(244,236,219,.72);max-width:44ch;}',
    '.bf-clock{display:flex;align-items:center;gap:10px;}',
    '.bf-track{flex:1;height:8px;border-radius:99px;background:rgba(244,236,219,.16);overflow:hidden;}',
    '.bf-fill{height:100%;width:100%;background:var(--bf-yolk);transform-origin:left center;transition:transform .25s linear;}',
    '.bf-fill.bf-urgent{background:var(--bf-rust);}',
    '.bf-secs{font-family:"Avenir Next Condensed","Futura",sans-serif;font-weight:700;font-size:20px;min-width:2.6em;text-align:right;}',
    '.bf-card{background:var(--bf-card);border-radius:20px;padding:16px;}',
    '.bf-field{width:100%;font-size:19px;padding:14px 16px;border-radius:16px;border:2px solid rgba(244,236,219,.22);background:rgba(13,42,48,.6);color:var(--bf-bone);font-family:inherit;}',
    '.bf-field:focus{outline:none;border-color:var(--bf-yolk);}',
    '.bf-btn{-webkit-appearance:none;appearance:none;border:0;border-radius:16px;padding:15px 18px;font-size:17px;font-weight:600;font-family:inherit;background:var(--bf-yolk);color:#20180a;touch-action:manipulation;}',
    '.bf-btn:disabled{opacity:.45;}',
    '.bf-btn-quiet{background:rgba(244,236,219,.14);color:var(--bf-bone);}',
    '.bf-btn-rec{background:var(--bf-rust);color:#fff;}',
    '.bf-row{display:flex;gap:10px;align-items:center;}',
    '.bf-row-wrap{flex-wrap:wrap;}',
    '.bf-grow{flex:1;}',
    '.bf-tally{font-size:14px;color:rgba(244,236,219,.66);}',
    '.bf-bird{position:relative;width:100%;aspect-ratio:1/1;}',
    '.bf-bird .bf-bodyimg{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;z-index:2;}',
    '.bf-wingwrap{position:absolute;top:30%;width:52%;height:34%;z-index:1;}',
    '.bf-wingwrap.bf-l{right:52%;}',
    '.bf-wingwrap.bf-r{left:52%;transform:scaleX(-1);}',
    '.bf-wingspin{width:100%;height:100%;transform-origin:100% 42%;animation:bf-flap 620ms ease-in-out infinite;}',
    '.bf-wingimg{width:100%;height:100%;object-fit:contain;object-position:100% 50%;}',
    '.bf-bird.bf-ghost{opacity:.55;}',
    '@keyframes bf-flap{0%{transform:rotate(-22deg);}50%{transform:rotate(24deg);}100%{transform:rotate(-22deg);}}',
    '@keyframes bf-bob{0%{transform:translateY(0);}50%{transform:translateY(-8px);}100%{transform:translateY(0);}}',
    '.bf-perch{animation:bf-bob 2.4s ease-in-out infinite;}',
    '.bf-bird.bf-dead .bf-wingspin{animation:none;transform:rotate(58deg);}',
    '.bf-bird.bf-dead{transform:rotate(168deg) translateY(10px);opacity:.5;filter:grayscale(.7);transition:transform .7s ease-in,opacity .7s;}',
    '.bf-bird.bf-victor .bf-wingspin{animation-duration:260ms;}',
    '@media (prefers-reduced-motion:reduce){.bf-wingspin,.bf-perch{animation:none !important;}.bf-bird.bf-dead{transition:none;}}',
    '.bf-duel{display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:start;}',
    '.bf-contender{background:var(--bf-card);border-radius:20px;padding:12px 10px 14px;display:flex;flex-direction:column;gap:8px;align-items:center;text-align:center;border:3px solid transparent;}',
    '.bf-contender.bf-picked{border-color:var(--bf-yolk);}',
    '.bf-contender .bf-bird{max-width:180px;margin:0 auto;}',
    '.bf-bname{font-family:"Avenir Next Condensed","Futura",sans-serif;font-weight:700;font-size:20px;line-height:1.05;}',
    '.bf-owner{display:flex;align-items:center;gap:6px;font-size:13px;color:rgba(244,236,219,.62);}',
    '.bf-owner>*:first-child{width:22px;height:22px;border-radius:99px;flex:0 0 auto;overflow:hidden;display:block;}',
    '.bf-owner img,.bf-owner canvas,.bf-owner svg{width:22px;height:22px;border-radius:99px;display:block;}',
    '.bf-initials{width:22px;height:22px;border-radius:99px;background:rgba(244,236,219,.2);display:flex;align-items:center;justify-content:center;font-size:12px;}',
    '.bf-callbtn{-webkit-appearance:none;appearance:none;border:0;border-radius:99px;padding:8px 14px;font-size:14px;font-family:inherit;background:rgba(244,236,219,.14);color:var(--bf-bone);display:inline-flex;gap:7px;align-items:center;}',
    '.bf-callbtn.bf-playing{background:var(--bf-leaf);color:#0d2a30;}',
    '.bf-callbtn-text{font-family:"Avenir Next Condensed","Futura",sans-serif;letter-spacing:.06em;}',
    '.bf-callicon{font-size:10px;}',
    '.bf-verdict{font-family:"Avenir Next Condensed","Futura",sans-serif;font-weight:700;font-size:clamp(26px,9vw,44px);line-height:1;}',
    '.bf-flew{color:var(--bf-leaf);}',
    '.bf-flu{color:var(--bf-flu);}',
    '.bf-aviary{display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:12px;}',
    '.bf-aviary .bf-bird{max-width:120px;margin:0 auto;}',
    '.bf-perchcard{display:flex;flex-direction:column;gap:4px;align-items:center;text-align:center;}',
    '.bf-perchcard .bf-bname{font-size:15px;}',
    '.bf-pad{background:var(--bf-bone);border-radius:18px;touch-action:none;display:block;width:100%;}',
    '.bf-tabs{display:flex;gap:8px;}',
    '.bf-tab{flex:1;border:0;border-radius:14px;padding:11px;font-size:15px;font-family:inherit;font-weight:600;background:rgba(244,236,219,.14);color:var(--bf-bone);}',
    '.bf-tab.bf-on{background:var(--bf-bone);color:#123b44;}',
    '.bf-swatches{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}',
    '.bf-swatch{width:34px;height:34px;border-radius:99px;border:3px solid rgba(244,236,219,.25);padding:0;}',
    '.bf-swatch.bf-on{border-color:var(--bf-bone);transform:scale(1.08);}',
    '.bf-nib{width:34px;height:34px;border-radius:12px;border:2px solid rgba(244,236,219,.25);background:rgba(244,236,219,.08);display:flex;align-items:center;justify-content:center;}',
    '.bf-nib.bf-on{border-color:var(--bf-yolk);}',
    '.bf-nibdot{background:var(--bf-bone);border-radius:99px;}',
    '.bf-standings{display:flex;flex-direction:column;gap:2px;}',
    '.bf-rank{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:12px;background:rgba(244,236,219,.06);}',
    '.bf-rank .bf-pts{margin-left:auto;font-family:"Avenir Next Condensed","Futura",sans-serif;font-weight:700;font-size:18px;color:var(--bf-yolk);}',
    '.bf-rank .bf-who{font-size:13px;color:rgba(244,236,219,.6);}',
    '.bf-tile{width:100%;border-radius:18px;display:block;}',
    '.bf-hint{font-size:13px;color:rgba(244,236,219,.6);}',
    '.bf-champ{max-width:280px;margin:0 auto;}',
    '@media (max-width:360px){.bf-duel{grid-template-columns:1fr;}}'
  ].join('');

  function ensureStyle() {
    if (document.getElementById('bf-style')) return;
    var s = document.createElement('style');
    s.id = 'bf-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function clock(totalMs) {
    var wrap = el('div', 'bf-clock');
    var track = el('div', 'bf-track');
    var fill = el('div', 'bf-fill');
    fill.setAttribute('data-total', String(totalMs));
    track.appendChild(fill);
    var secs = el('div', 'bf-secs', '--');
    wrap.appendChild(track);
    wrap.appendChild(secs);
    return wrap;
  }

  function tick() {
    if (!root || !view) return;
    var s = secsLeft();
    var fills = root.querySelectorAll('.bf-fill');
    for (var i = 0; i < fills.length; i++) {
      var total = Number(fills[i].getAttribute('data-total')) || 30000;
      var f = fracLeft(total);
      fills[i].style.transform = 'scaleX(' + f.toFixed(3) + ')';
      fills[i].classList.toggle('bf-urgent', s != null && s <= 8);
    }
    var outs = root.querySelectorAll('.bf-secs');
    for (var j = 0; j < outs.length; j++) outs[j].textContent = s == null ? '' : s + 's';
    chaseMissingArt();
    if (draw && draw.active && !draw.sent && s != null && s <= 2) {
      draw.sent = true;
      submitDrawing(true);
    }
  }

  /* ---------------- panes ---------------- */

  function newPane(name) {
    var p = el('section', 'bf-pane');
    p.setAttribute('data-phase', name);
    root.appendChild(p);
    pane[name] = p;
    return p;
  }

  function showOnly(name) {
    Object.keys(pane).forEach(function (k) {
      if (k === name) pane[k].removeAttribute('hidden');
      else pane[k].setAttribute('hidden', '');
    });
  }

  /* -------- intro -------- */

  function buildIntro(p) {
    clear(p);
    p.appendChild(el('h1', 'bf-display bf-h1', 'Bird Flew'));
    p.appendChild(el('p', 'bf-sub', 'Invent a bird nobody has ever seen. Name it, record its call, draw it. Then the birds fight, and only one flies home.'));
    var card = el('div', 'bf-card');
    var steps = [
      'Name your species',
      'Record its call',
      'Draw its body and one wing',
      'Vote the flock down to a champion'
    ];
    steps.forEach(function (t, i) {
      var r = el('div', 'bf-row');
      r.appendChild(el('span', 'bf-secs', String(i + 1)));
      r.appendChild(el('span', 'bf-grow', t));
      card.appendChild(r);
    });
    p.appendChild(card);
    if (view.isHost) {
      var go = el('button', 'bf-btn', 'Start the hatching');
      go.addEventListener('click', function () { go.disabled = true; api.send('start', {}); });
      p.appendChild(go);
    } else {
      p.appendChild(el('p', 'bf-hint', 'Waiting for the host to start.'));
    }
  }

  /* -------- name -------- */

  function buildName(p) {
    clear(p);
    p.appendChild(clock(40000));
    p.appendChild(el('h2', 'bf-display bf-h2', 'Name your species'));
    p.appendChild(el('p', 'bf-sub', 'Something that sounds real enough to be in a field guide. Nobody sees it yet.'));
    var input = el('input', 'bf-field');
    input.type = 'text';
    input.maxLength = 28;
    input.placeholder = 'Lesser Spotted...';
    input.autocomplete = 'off';
    input.value = (view.myBird && view.myBird.name) || '';
    p.appendChild(input);
    var btn = el('button', 'bf-btn', 'Lock it in');
    var status = el('p', 'bf-hint', '');
    btn.addEventListener('click', function () {
      var v = input.value.trim();
      if (!v) { say('Give it a name first.', 'bad'); return; }
      api.send('name', { text: v });
      api.send('ready', {});
    });
    input.addEventListener('input', function () {
      if (view && view.submitted) api.send('unready', {});
    });
    p.appendChild(btn);
    p.appendChild(status);
    p._input = input; p._btn = btn; p._status = status;
  }

  function fillName(p) {
    if (view.submitted) {
      p._btn.disabled = true;
      p._btn.textContent = 'Named';
      p._input.disabled = true;
    } else {
      p._btn.disabled = false;
      p._btn.textContent = 'Lock it in';
      p._input.disabled = false;
    }
    p._status.textContent = view.doneCount + ' of ' + view.total + ' named';
  }

  /* -------- sound -------- */

  function buildSound(p) {
    clear(p);
    p.appendChild(clock(60000));
    var title = el('h2', 'bf-display bf-h2', 'Give it a voice');
    p.appendChild(title);
    p.appendChild(el('p', 'bf-sub', 'Up to five seconds. Do it into your hand if the room is loud.'));

    var recBtn = el('button', 'bf-btn bf-btn-rec', 'Record the call');
    var preview = el('button', 'bf-btn bf-btn-quiet', 'Play it back');
    preview.setAttribute('hidden', '');
    var recRow = el('div', 'bf-row bf-row-wrap');
    recRow.appendChild(recBtn);
    recRow.appendChild(preview);
    p.appendChild(recRow);

    p.appendChild(el('p', 'bf-hint', 'Or write it, if recording is a problem.'));
    var callInput = el('input', 'bf-field');
    callInput.type = 'text';
    callInput.maxLength = 18;
    callInput.placeholder = 'KA-KAW';
    callInput.value = (view.myBird && view.myBird.call) || '';
    p.appendChild(callInput);

    var done = el('button', 'bf-btn', 'That is its call');
    var status = el('p', 'bf-hint', '');
    p.appendChild(done);
    p.appendChild(status);

    recBtn.addEventListener('click', function () { toggleRecord(recBtn, preview, status); });
    preview.addEventListener('click', function () {
      if (rec && rec.url) { try { new Audio(rec.url).play(); } catch (e) { /* ignore */ } }
    });
    done.addEventListener('click', function () {
      var t = callInput.value.trim();
      if (t) api.send('call', { text: t });
      api.send('ready', {});
    });
    callInput.addEventListener('input', function () {
      if (view && view.submitted) api.send('unready', {});
    });

    p._done = done; p._status = status; p._title = title;
  }

  function fillSound(p) {
    var bird = view.myBird || {};
    p._title.textContent = bird.name ? 'How does ' + bird.name + ' sound?' : 'Give it a voice';
    p._done.disabled = !!view.submitted;
    p._done.textContent = view.submitted ? 'Recorded' : 'That is its call';
    p._status.textContent = view.doneCount + ' of ' + view.total + ' ready';
  }

  function toggleRecord(btn, preview, status) {
    if (rec && rec.recorder && rec.recorder.state === 'recording') {
      stopRecord();
      return;
    }
    if (!navigator.mediaDevices || !window.MediaRecorder) {
      say('This browser cannot record. Write the call instead.', 'bad');
      btn.disabled = true;
      return;
    }
    btn.textContent = 'Asking for the mic...';
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      var chunks = [];
      var mr;
      try { mr = new MediaRecorder(stream); }
      catch (e) { mr = new MediaRecorder(stream, { mimeType: 'audio/mp4' }); }
      rec = { recorder: mr, stream: stream, chunks: chunks, url: rec && rec.url ? rec.url : null, btn: btn, preview: preview, status: status };
      mr.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      mr.onstop = function () {
        stream.getTracks().forEach(function (t) { t.stop(); });
        finishRecord(chunks, mr.mimeType);
      };
      mr.start();
      btn.textContent = 'Stop (5s max)';
      btn.classList.add('bf-playing');
      rec.autoStop = setTimeout(stopRecord, REC_MS);
    }).catch(function () {
      btn.textContent = 'Record the call';
      say('No microphone access. Write the call instead.', 'bad');
    });
  }

  function stopRecord() {
    if (!rec || !rec.recorder) return;
    if (rec.autoStop) { clearTimeout(rec.autoStop); rec.autoStop = null; }
    if (rec.recorder.state !== 'inactive') {
      try { rec.recorder.stop(); } catch (e) { /* ignore */ }
    }
  }

  function finishRecord(chunks, mime) {
    var btn = rec && rec.btn;
    if (btn) { btn.textContent = 'Record again'; btn.classList.remove('bf-playing'); }
    if (!chunks.length) return;
    var blob = new Blob(chunks, { type: mime || 'audio/mp4' });
    if (blob.size > MAX_AUDIO_BYTES) {
      say('That recording is too heavy. Try a shorter one.', 'bad');
      return;
    }
    if (rec.url) { try { URL.revokeObjectURL(rec.url); } catch (e) { /* ignore */ } }
    rec.url = URL.createObjectURL(blob);
    urls.push(rec.url);
    if (rec.preview) rec.preview.removeAttribute('hidden');
    blobToDataUrl(blob).then(function (d) {
      api.send('audio', { data: d });
      if (rec.status) rec.status.textContent = 'Call saved.';
    }).catch(function () { say('Could not save that recording.', 'bad'); });
  }

  /* -------- draw -------- */

  function buildDraw(p) {
    clear(p);
    p.appendChild(clock(165000));
    var title = el('h2', 'bf-display bf-h2', 'Draw it');
    p.appendChild(title);
    p.appendChild(el('p', 'bf-sub', 'Body first, then one wing on its own layer. The wing gets mirrored and flapped, so draw it pointing left.'));

    var tabs = el('div', 'bf-tabs');
    var tBody = el('button', 'bf-tab bf-on', 'Body');
    var tWing = el('button', 'bf-tab', 'Wing');
    tabs.appendChild(tBody); tabs.appendChild(tWing);
    p.appendChild(tabs);

    var pad = el('canvas', 'bf-pad');
    p.appendChild(pad);

    var swatches = el('div', 'bf-swatches');
    INK.forEach(function (c, i) {
      var s = el('button', 'bf-swatch' + (i === 0 ? ' bf-on' : ''));
      s.style.background = c.hex;
      s.setAttribute('data-hex', c.hex);
      s.addEventListener('click', function () {
        draw.color = c.hex;
        draw.erasing = false;
        var all = swatches.querySelectorAll('.bf-swatch');
        for (var k = 0; k < all.length; k++) all[k].classList.toggle('bf-on', all[k] === s);
        syncErase();
      });
      swatches.appendChild(s);
    });
    p.appendChild(swatches);

    var nibs = el('div', 'bf-swatches');
    [4, 10, 22].forEach(function (w, i) {
      var n = el('button', 'bf-nib' + (i === 1 ? ' bf-on' : ''));
      var dot = el('span', 'bf-nibdot');
      dot.style.width = Math.max(4, w / 1.6) + 'px';
      dot.style.height = Math.max(4, w / 1.6) + 'px';
      n.appendChild(dot);
      n.addEventListener('click', function () {
        draw.size = w;
        var all = nibs.querySelectorAll('.bf-nib');
        for (var k = 0; k < all.length; k++) all[k].classList.toggle('bf-on', all[k] === n);
      });
      nibs.appendChild(n);
    });
    var erase = el('button', 'bf-btn bf-btn-quiet', 'Erase');
    var undo = el('button', 'bf-btn bf-btn-quiet', 'Undo');
    var wipe = el('button', 'bf-btn bf-btn-quiet', 'Clear');
    nibs.appendChild(erase); nibs.appendChild(undo); nibs.appendChild(wipe);
    p.appendChild(nibs);

    var send = el('button', 'bf-btn', 'Release the bird');
    var status = el('p', 'bf-hint', '');
    p.appendChild(send);
    p.appendChild(status);

    draw = {
      active: true,
      sent: false,
      layer: 'body',
      color: INK[0].hex,
      size: 10,
      erasing: false,
      strokes: { body: [], wing: [] },
      canvas: pad,
      ctx: pad.getContext('2d'),
      current: null
    };

    function setLayer(name) {
      draw.layer = name;
      tBody.classList.toggle('bf-on', name === 'body');
      tWing.classList.toggle('bf-on', name === 'wing');
      sizePad();
      repaint();
    }
    tBody.addEventListener('click', function () { setLayer('body'); });
    tWing.addEventListener('click', function () { setLayer('wing'); });
    function syncErase() {
      erase.classList.toggle('bf-btn-rec', draw.erasing);
      erase.textContent = draw.erasing ? 'Erasing' : 'Erase';
    }
    erase.addEventListener('click', function () {
      draw.erasing = !draw.erasing;
      syncErase();
    });
    undo.addEventListener('click', function () { draw.strokes[draw.layer].pop(); repaint(); });
    wipe.addEventListener('click', function () { draw.strokes[draw.layer] = []; repaint(); });
    send.addEventListener('click', function () {
      if (draw.sent) return;
      draw.sent = true;
      send.disabled = true;
      send.textContent = 'Sending...';
      submitDrawing(false);
    });

    p._status = status;
    p._send = send;
    p._title = title;

    attachPointer(pad);
    sizePad();
    repaint();
    window.addEventListener('resize', onResize);
  }

  function onResize() {
    if (!draw || !draw.canvas.isConnected) return;
    sizePad();
    repaint();
  }

  function padAspect() { return draw.layer === 'body' ? (BODY_H / BODY_W) : (WING_H / WING_W); }

  function sizePad() {
    var c = draw.canvas;
    var cssW = c.parentNode ? c.parentNode.clientWidth : 320;
    if (!cssW) cssW = 320;
    var cssH = Math.round(cssW * padAspect());
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    c.style.height = cssH + 'px';
    c.width = Math.round(cssW * dpr);
    c.height = Math.round(cssH * dpr);
    draw.dpr = dpr;
    draw.cssW = cssW;
    draw.cssH = cssH;
  }

  function attachPointer(c) {
    function pos(ev) {
      var r = c.getBoundingClientRect();
      var t = (ev.touches && ev.touches[0]) || ev;
      return { x: (t.clientX - r.left) / r.width, y: (t.clientY - r.top) / r.height };
    }
    function start(ev) {
      ev.preventDefault();
      draw.current = { color: draw.color, size: draw.size, erase: draw.erasing, pts: [pos(ev)] };
      draw.strokes[draw.layer].push(draw.current);
      repaint();
    }
    function move(ev) {
      if (!draw.current) return;
      ev.preventDefault();
      draw.current.pts.push(pos(ev));
      repaint();
    }
    function end(ev) {
      if (!draw.current) return;
      if (ev) ev.preventDefault();
      draw.current = null;
    }
    if (window.PointerEvent) {
      c.addEventListener('pointerdown', start);
      c.addEventListener('pointermove', move);
      c.addEventListener('pointerup', end);
      c.addEventListener('pointercancel', end);
      c.addEventListener('pointerleave', end);
    } else {
      c.addEventListener('touchstart', start, { passive: false });
      c.addEventListener('touchmove', move, { passive: false });
      c.addEventListener('touchend', end);
      c.addEventListener('mousedown', start);
      c.addEventListener('mousemove', move);
      c.addEventListener('mouseup', end);
    }
  }

  function paintStrokes(g, strokes, w, h, guides) {
    g.clearRect(0, 0, w, h);
    if (guides) {
      g.save();
      g.strokeStyle = 'rgba(18,59,68,.18)';
      g.setLineDash([6, 8]);
      g.lineWidth = 2;
      if (guides === 'body') {
        g.beginPath();
        g.ellipse(w * 0.5, h * 0.55, w * 0.3, h * 0.26, 0, 0, Math.PI * 2);
        g.stroke();
      } else {
        g.beginPath();
        g.moveTo(w * 0.94, h * 0.1);
        g.lineTo(w * 0.94, h * 0.9);
        g.stroke();
      }
      g.restore();
    }
    g.lineCap = 'round';
    g.lineJoin = 'round';
    strokes.forEach(function (s) {
      if (!s.pts.length) return;
      g.save();
      g.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over';
      g.strokeStyle = s.color;
      g.lineWidth = s.size * (w / 420);
      g.beginPath();
      g.moveTo(s.pts[0].x * w, s.pts[0].y * h);
      if (s.pts.length === 1) g.lineTo(s.pts[0].x * w + 0.1, s.pts[0].y * h + 0.1);
      for (var i = 1; i < s.pts.length; i++) g.lineTo(s.pts[i].x * w, s.pts[i].y * h);
      g.stroke();
      g.restore();
    });
  }

  function repaint() {
    if (!draw) return;
    var g = draw.ctx;
    var w = draw.canvas.width, h = draw.canvas.height;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, w, h);
    paintStrokes(g, draw.strokes[draw.layer], w, h, draw.layer);
  }

  function exportLayer(layer, w, h) {
    return new Promise(function (resolve) {
      function attempt(scale) {
        var c = document.createElement('canvas');
        c.width = Math.round(w * scale);
        c.height = Math.round(h * scale);
        paintStrokes(c.getContext('2d'), draw.strokes[layer], c.width, c.height, null);
        // toBlob, not toDataURL — Safari drops oversized data URLs from canvas
        c.toBlob(function (blob) {
          if (!blob) { resolve(''); return; }
          blobToDataUrl(blob).then(function (d) {
            if (d.length > MAX_IMG_CHARS && scale > 0.5) { attempt(scale * 0.75); return; }
            resolve(d.length > MAX_IMG_CHARS ? '' : d);
          }).catch(function () { resolve(''); });
        }, 'image/png');
      }
      if (!draw.strokes[layer].length) { resolve(''); return; }
      attempt(1);
    });
  }

  function submitDrawing(auto) {
    Promise.all([exportLayer('body', BODY_W, BODY_H), exportLayer('wing', WING_W, WING_H)])
      .then(function (out) {
        if (out[0] || out[1]) api.send('art', { body: out[0], wing: out[1] });
        api.send('ready', {});
        var p = pane.draw;
        if (p && p._status) p._status.textContent = auto ? 'Time. Sent what you had.' : 'Away it goes.';
      })
      .catch(function () {
        api.send('ready', {});
        say('The drawing would not export. Your bird goes out as a silhouette.', 'bad');
      });
  }

  function fillDraw(p) {
    var bird = view.myBird || {};
    p._title.textContent = bird.name ? 'Draw ' + bird.name : 'Draw it';
    if (view.submitted && p._send) {
      p._send.disabled = true;
      p._send.textContent = 'Released';
    }
    if (p._status && !draw.sent) p._status.textContent = view.doneCount + ' of ' + view.total + ' finished';
  }

  /* -------- reveal -------- */

  function buildReveal(p) {
    clear(p);
    p.appendChild(clock(11000));
    p.appendChild(el('h2', 'bf-display bf-h2', 'The flock'));
    p.appendChild(el('p', 'bf-sub', 'Every bird here was invented in the last four minutes.'));
    var grid = el('div', 'bf-aviary');
    (view.flock || []).forEach(function (b) {
      var card = el('div', 'bf-perchcard');
      var bird = birdEl(b.id, { small: true });
      bird.classList.add('bf-perch');
      card.appendChild(bird);
      card.appendChild(el('div', 'bf-bname', b.name));
      card.appendChild(callBtn(b));
      grid.appendChild(card);
    });
    p.appendChild(grid);
  }

  /* -------- vote -------- */

  function contenderEl(bird, side, m) {
    var card = el('div', 'bf-contender');
    card.appendChild(birdEl(bird.id, {}));
    card.appendChild(el('div', 'bf-bname', bird.name));
    var who = el('div', 'bf-owner');
    who.appendChild(faceFor(bird.id));
    who.appendChild(el('span', null, bird.owner));
    card.appendChild(who);
    card.appendChild(callBtn(bird));
    if (m.myVote === side) card.classList.add('bf-picked');
    if (m.canVote) {
      var pickBtn = el('button', 'bf-btn bf-btn-quiet', m.myVote === side ? 'Your pick' : 'Pick this one');
      pickBtn.addEventListener('click', function () { api.send('vote', { choice: side }); });
      card.appendChild(pickBtn);
    }
    return card;
  }

  function buildVote(p) {
    clear(p);
    var m = view.match;
    if (!m) return;
    p.appendChild(clock(25000));
    var head = el('div', 'bf-row');
    head.appendChild(el('h2', 'bf-display bf-h2 bf-grow', view.roundName));
    head.appendChild(el('span', 'bf-tally', 'Match ' + m.index + ' of ' + m.of));
    p.appendChild(head);
    if (view.byeName) p.appendChild(el('p', 'bf-hint', view.byeName + ' drew a bye and waits in the next round.'));

    var duel = el('div', 'bf-duel');
    if (m.a) duel.appendChild(contenderEl(m.a, 'a', m));
    if (m.b) duel.appendChild(contenderEl(m.b, 'b', m));
    p.appendChild(duel);

    if (!m.canVote) p.appendChild(el('p', 'bf-sub', 'Your bird is in this one. Sit tight.'));
    var status = el('p', 'bf-hint', '');
    p.appendChild(status);
    p._status = status;
  }

  function fillVote(p) {
    var m = view.match;
    if (!m || !p._status) return;
    p._status.textContent = m.votesIn + ' of ' + m.votersNeeded + ' votes in';
  }

  /* -------- match result -------- */

  function buildResult(p) {
    clear(p);
    var m = view.match;
    if (!m) return;
    var duel = el('div', 'bf-duel');
    [['a', m.a], ['b', m.b]].forEach(function (pair) {
      var bird = pair[1];
      if (!bird) return;
      var won = bird.id === m.winnerId;
      var card = el('div', 'bf-contender');
      var b = birdEl(bird.id, {});
      b.classList.add(won ? 'bf-victor' : 'bf-dead');
      card.appendChild(b);
      card.appendChild(el('div', 'bf-verdict ' + (won ? 'bf-flew' : 'bf-flu'), won ? 'BIRD FLEW' : 'BIRD FLU'));
      card.appendChild(el('div', 'bf-bname', bird.name));
      card.appendChild(el('div', 'bf-tally', (m.tally ? m.tally[pair[0]] : 0) + (m.tally && m.tally[pair[0]] === 1 ? ' vote' : ' votes')));
      duel.appendChild(card);
    });
    p.appendChild(duel);
    if (m.gust) p.appendChild(el('p', 'bf-sub', 'A dead heat. A gust of wind picked the survivor.'));
    p.appendChild(clock(6500));
  }

  /* -------- champion -------- */

  function buildChampion(p) {
    clear(p);
    var champId = view.championId;
    var champ = (view.flock || []).filter(function (b) { return b.id === champId; })[0];
    p.appendChild(el('h1', 'bf-display bf-h1 bf-flew', 'BIRD FLEW'));
    if (champ) {
      var holder = el('div', 'bf-champ');
      var b = birdEl(champ.id, {});
      b.classList.add('bf-victor', 'bf-perch');
      holder.appendChild(b);
      p.appendChild(holder);
      p.appendChild(el('h2', 'bf-display bf-h2', champ.name));
      var who = el('div', 'bf-owner');
      who.appendChild(faceFor(champ.id));
      who.appendChild(el('span', null, 'invented by ' + champ.owner));
      p.appendChild(who);
      p.appendChild(callBtn(champ));
    }

    var list = el('div', 'bf-standings');
    (view.standings || []).forEach(function (row) {
      var r = el('div', 'bf-rank');
      var col = el('div');
      col.appendChild(el('div', 'bf-bname', row.name));
      col.appendChild(el('div', 'bf-who', row.owner + (row.out ? '' : ' \u00b7 champion')));
      r.appendChild(col);
      r.appendChild(el('span', 'bf-pts', String(row.points)));
      list.appendChild(r);
    });
    p.appendChild(list);
    p.appendChild(el('p', 'bf-hint', '10 per fight won, 2 per vote your bird drew, 15 for the champion, 5 for finishing your bird.'));

    var tileBtn = el('button', 'bf-btn bf-btn-quiet', 'Make a picture of the flock');
    var tileBox = el('div');
    p.appendChild(tileBtn);
    p.appendChild(tileBox);
    tileBtn.addEventListener('click', function () {
      tileBtn.disabled = true;
      tileBtn.textContent = 'Painting...';
      buildTile().then(function (url) {
        tileBtn.textContent = 'Make it again';
        tileBtn.disabled = false;
        clear(tileBox);
        var img = el('img', 'bf-tile');
        img.src = url;
        tileBox.appendChild(img);
        var a = el('a', 'bf-btn', 'Save the picture');
        a.href = url;
        a.download = 'bird-flew.png';
        a.style.display = 'inline-block';
        a.style.textAlign = 'center';
        a.style.textDecoration = 'none';
        tileBox.appendChild(a);
        tileBox.appendChild(el('p', 'bf-hint', 'On an iPhone, long-press the picture and choose Add to Photos.'));
      }).catch(function () {
        tileBtn.disabled = false;
        tileBtn.textContent = 'Make a picture of the flock';
        say('The picture would not paint.', 'bad');
      });
    });

    if (view.isHost) {
      var end = el('button', 'bf-btn', 'Bank the points and finish');
      end.addEventListener('click', function () { end.disabled = true; api.send('end', {}); });
      p.appendChild(end);
    }
    p.appendChild(clock(180000));
  }

  /* -------- social tile -------- */

  function ready(img) {
    if (!img) return Promise.resolve(null);
    if (img.complete && img.naturalWidth) return Promise.resolve(img);
    return new Promise(function (resolve) {
      img.onload = function () { resolve(img); };
      img.onerror = function () { resolve(null); };
      setTimeout(function () { resolve(img.complete ? img : null); }, 2500);
    });
  }

  function drawBird(g, entry, cx, cy, size, angle) {
    var body = entry && entry.body;
    var wing = entry && entry.wing;
    var ww = size * 0.62, wh = ww * (WING_H / WING_W);
    var sy = cy - size * 0.06;
    [-1, 1].forEach(function (dir) {
      if (!wing || !wing.naturalWidth) return;
      g.save();
      g.translate(cx + dir * size * 0.06, sy);
      g.scale(dir, 1);
      g.rotate(-angle);
      g.drawImage(wing, -ww, -wh * 0.42, ww, wh);
      g.restore();
    });
    if (body && body.naturalWidth) {
      g.drawImage(body, cx - size / 2, cy - size / 2, size, size);
    }
  }

  function buildTile() {
    var flock = (view.flock || []).slice();
    var champId = view.championId;
    var champ = flock.filter(function (b) { return b.id === champId; })[0];
    var others = flock.filter(function (b) { return b.id !== champId; }).slice(0, 8);
    var needed = [];
    flock.forEach(function (b) {
      var a = artStore[b.id];
      if (a) { needed.push(ready(a.body)); needed.push(ready(a.wing)); }
    });

    return Promise.all(needed).then(function () {
      var W = 1080, H = 1080;
      var c = document.createElement('canvas');
      c.width = W; c.height = H;
      var g = c.getContext('2d');

      var sky = g.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, '#0d2a30');
      sky.addColorStop(0.55, '#16454f');
      sky.addColorStop(1, '#0d2a30');
      g.fillStyle = sky;
      g.fillRect(0, 0, W, H);
      g.fillStyle = 'rgba(244,236,219,.18)';
      for (var i = 0; i < 90; i++) {
        var r = Math.random() * 2 + 0.6;
        g.beginPath();
        g.arc(Math.random() * W, Math.random() * H * 0.7, r, 0, Math.PI * 2);
        g.fill();
      }

      g.textAlign = 'center';
      g.fillStyle = '#79cf9a';
      g.font = '700 118px "Avenir Next Condensed", "Futura", Helvetica, sans-serif';
      g.fillText('BIRD FLEW', W / 2, 138);

      if (champ) {
        drawBird(g, artStore[champ.id], W / 2, 470, 470, 0.36);
        g.fillStyle = '#f4ecdb';
        g.font = '700 74px "Avenir Next Condensed", "Futura", Helvetica, sans-serif';
        g.fillText(champ.name, W / 2, 762);
        g.fillStyle = 'rgba(244,236,219,.62)';
        g.font = '400 34px -apple-system, Helvetica, sans-serif';
        g.fillText('invented by ' + champ.owner, W / 2, 806);
      }

      var cols = Math.max(1, others.length);
      var slot = W / cols;
      others.forEach(function (b, idx) {
        var cx = slot * idx + slot / 2;
        var cy = 930;
        var size = Math.min(150, slot * 0.78);
        g.save();
        g.globalAlpha = 0.85;
        if (b.out) {
          g.translate(cx, cy);
          g.rotate(Math.PI * 0.94);
          g.translate(-cx, -cy);
        }
        drawBird(g, artStore[b.id], cx, cy, size, 0.2);
        g.restore();
        g.fillStyle = b.out ? 'rgba(185,140,214,.9)' : 'rgba(121,207,154,.9)';
        g.font = '700 22px "Avenir Next Condensed", "Futura", Helvetica, sans-serif';
        g.fillText(b.out ? 'BIRD FLU' : 'BIRD FLEW', cx, cy + size * 0.62 + 24);
        g.fillStyle = 'rgba(244,236,219,.8)';
        g.font = '400 20px -apple-system, Helvetica, sans-serif';
        var label = b.name.length > 16 ? b.name.slice(0, 15) + '\u2026' : b.name;
        g.fillText(label, cx, cy + size * 0.62 + 48);
      });

      g.fillStyle = 'rgba(244,236,219,.45)';
      g.font = '400 26px -apple-system, Helvetica, sans-serif';
      g.fillText('bingo bango', W / 2, H - 28);

      return new Promise(function (resolve, reject) {
        // toBlob + object URL: a 1080px data URL is exactly what Safari drops
        c.toBlob(function (blob) {
          if (!blob) { reject(new Error('no blob')); return; }
          if (tileUrl) { try { URL.revokeObjectURL(tileUrl); } catch (e) { /* ignore */ } }
          tileUrl = URL.createObjectURL(blob);
          urls.push(tileUrl);
          resolve(tileUrl);
        }, 'image/png');
      });
    });
  }

  /* ---------------- lifecycle ---------------- */

  function signature(v) {
    var m = v.match;
    return [v.phase, v.round, m ? m.index : '', m ? (m.a && m.a.id) + '-' + (m.b && m.b.id) : '', v.championId || ''].join('|');
  }

  BB.registerGame({
    id: 'birdflew',

    mount: function (container, theApi) {
      api = theApi;
      ensureStyle();
      root = el('div');
      root.id = 'bf-root';
      container.appendChild(root);
      pane = {};
      ['intro', 'name', 'sound', 'draw', 'reveal', 'vote', 'matchresult', 'champion'].forEach(newPane);
      artStore = {};
      mountedBirds = [];
      sig = '';
      ticker = setInterval(tick, 250);
      api.send('art:need', { ids: [] });
    },

    render: function (v, theApi) {
      if (theApi) api = theApi;
      view = v || {};
      var gotArt = ingestArt(view.art);
      if (gotArt) rehydrateAll();

      var s = signature(view);
      var phase = view.phase;
      var p = pane[phase];
      if (!p) return;

      if (s !== sig) {
        sig = s;
        if (phase !== 'draw' && draw) { draw.active = false; }
        if (phase === 'intro') buildIntro(p);
        else if (phase === 'name') buildName(p);
        else if (phase === 'sound') buildSound(p);
        else if (phase === 'draw') buildDraw(p);
        else if (phase === 'reveal') buildReveal(p);
        else if (phase === 'vote') buildVote(p);
        else if (phase === 'matchresult') buildResult(p);
        else if (phase === 'champion') buildChampion(p);
        showOnly(phase);
        if (phase === 'draw') { sizePad(); repaint(); }
      } else {
        showOnly(phase);
      }

      if (phase === 'name') fillName(p);
      else if (phase === 'sound') fillSound(p);
      else if (phase === 'draw') fillDraw(p);
      else if (phase === 'vote') fillVote(p);

      if (gotArt) rehydrateAll();
      tick();
    },

    unmount: function () {
      if (ticker) clearInterval(ticker);
      ticker = null;
      window.removeEventListener('resize', onResize);
      stopRecord();
      if (playing) { try { playing.pause(); } catch (e) { /* ignore */ } playing = null; }
      urls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) { /* ignore */ } });
      urls = [];
      artStore = {};
      mountedBirds = [];
      draw = null;
      rec = null;
      tileUrl = null;
      view = null;
      sig = '';
      if (root && root.parentNode) root.parentNode.removeChild(root);
      root = null;
      pane = {};
    }
  });
})();
