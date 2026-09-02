/* ============================================================
   Plot Party — client module
   Registers itself with the shell, which mounts it into a
   container and calls render() on every state push.
   ============================================================ */

(function () {
'use strict';

var CSS = `
.pp{flex:1;min-height:0;display:flex;flex-direction:column;gap:.5rem;padding:0 var(--pad)}
.pp-top{display:flex;align-items:center;gap:.6rem;font-size:.8rem;color:var(--dim)}
.pp-top .mode{font-family:'Archivo Black';color:var(--cream);font-size:.9rem}
.pp-top .clock{margin-left:auto;font-size:1.3rem}
.pp-cog{background:var(--ink-lift);border:2px solid var(--ink-line);border-radius:10px;
  width:34px;height:34px;flex:none;cursor:pointer;font-size:1rem;color:var(--dim)}

.pp-said{text-align:center}
.pp-said .who{color:var(--dim);font-size:.82rem}
.pp-said h2{font-size:clamp(1.3rem,6vw,2rem);margin-top:.1rem;word-break:break-word}

.pp-stage{flex:1;min-height:0;display:grid;
  grid-template-columns:auto 1fr auto;grid-template-rows:auto 1fr auto;
  gap:.35rem;align-items:center;justify-items:center}
.pp-ax{color:var(--dim);font-size:.72rem;font-weight:700;text-align:center;max-width:9ch;line-height:1.15}
.pp-ax.v{writing-mode:vertical-rl;max-width:none;max-height:9em}
.pp-ax.l{transform:rotate(180deg)}

.pp-grid{
  grid-column:2;grid-row:2;position:relative;
  width:min(100%, 62vh);aspect-ratio:1;
  background:var(--ink-lift);border:2px solid var(--ink-line);border-radius:18px;
  touch-action:none;overflow:hidden;
}
.pp-grid:focus-visible{outline:3px solid var(--sky);outline-offset:3px}
.pp-cross::before,.pp-cross::after{content:"";position:absolute;background:var(--ink-line)}
.pp-cross::before{left:0;right:0;top:50%;height:2px}
.pp-cross::after{top:0;bottom:0;left:50%;width:2px}

.pp-dot{position:absolute;transform:translate(-50%,-50%);width:34px;height:34px;
  border-radius:50%;border:2px solid var(--ink);overflow:hidden;display:grid;place-items:center;
  font-weight:700;font-size:.85rem;color:var(--ink);transition:left .12s linear, top .12s linear}
.pp-dot img{width:100%;height:100%;object-fit:cover}
.pp-dot.me{box-shadow:0 0 0 3px var(--cream)}
.pp-dot.out{box-shadow:0 0 0 3px var(--hot)}
.pp-avg{position:absolute;transform:translate(-50%,-50%);width:20px;height:20px;border-radius:50%;
  border:3px dashed var(--cream);opacity:.85}
.pp-target{position:absolute;transform:translate(-50%,-50%);font-size:1.7rem;line-height:1}
.pp-mark{position:absolute;transform:translate(-50%,-50%);pointer-events:none;text-align:center}
.pp-mark i{display:block;width:7px;height:7px;border-radius:50%;background:var(--dim);margin:0 auto}
.pp-mark span{font-size:.6rem;color:var(--dim);white-space:nowrap}

.pp-tally{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:.4rem;justify-content:center}
.pp-tally li{display:flex;align-items:center;gap:.3rem;font-size:.78rem;color:var(--dim)}
.pp-tally i{width:10px;height:10px;border-radius:50%;display:block}
.pp-tally b{color:var(--cream)}

.pp-foot{display:flex;flex-direction:column;gap:.5rem;
  padding-bottom:max(.4rem, env(safe-area-inset-bottom))}
.pp-foot .row{display:flex;gap:.5rem}
.pp-foot .row .btn{margin-top:0}
.pp-in{width:100%;background:var(--ink-lift);border:2px solid var(--ink-line);
  border-radius:12px;padding:.85rem .95rem}
.pp-in:focus{outline:none;border-color:var(--sky)}

.pp-sheet{position:fixed;inset:0;z-index:50;background:rgba(10,6,26,.8);
  display:flex;align-items:flex-end}
.pp-card{background:var(--ink);border-top:3px solid var(--lime);border-radius:20px 20px 0 0;
  width:100%;max-height:88dvh;overflow-y:auto;padding:1.1rem var(--pad)
  max(1.1rem, env(safe-area-inset-bottom))}
.pp-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:.4rem}
.pp-mini{display:grid;grid-template-columns:1fr 1fr;gap:.5rem}
.pp-chips{display:flex;flex-wrap:wrap;gap:.4rem}
.pp-chip{background:var(--ink-lift);border:2px solid var(--ink-line);border-radius:999px;
  padding:.35rem .8rem;font-size:.85rem;cursor:pointer;color:var(--cream)}
.pp-chip.on{border-color:var(--lime);color:var(--lime)}
.pp-warn{color:var(--dim);font-size:.78rem;margin:.35rem 0 0}
.pp-tile{position:fixed;inset:0;z-index:55;background:rgba(10,6,26,.94);
  display:flex;flex-direction:column;gap:.7rem;justify-content:center;padding:var(--pad)}
.pp-tile img{width:100%;border-radius:14px}
`;

var MODE_NAME = { live: 'Live', reveal: 'Countdown', clue: 'Clue giver' };

var el = {};          // cached nodes
var api = null;
var v = null;         // latest view
var dragging = false;
var tileUrl = null;

function h(tag, cls, text) {
  var n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/* ---------------- mount ---------------- */

function mount(host, _api) {
  api = _api;

  if (!document.getElementById('pp-style')) {
    var st = h('style'); st.id = 'pp-style'; st.textContent = CSS;
    document.head.appendChild(st);
  }

  host.innerHTML =
    '<div class="pp">' +
      '<div class="pp-top">' +
        '<span class="mode" id="pp-mode"></span>' +
        '<span id="pp-round"></span>' +
        '<span class="clock" id="pp-clock" hidden></span>' +
        '<button class="pp-cog" id="pp-cog" aria-label="Game settings" hidden>⚙</button>' +
      '</div>' +
      '<div class="pp-said">' +
        '<p class="who" id="pp-who"></p>' +
        '<h2 id="pp-item"></h2>' +
      '</div>' +
      '<div class="pp-stage">' +
        '<div class="pp-ax" id="pp-top" style="grid-column:2;grid-row:1"></div>' +
        '<div class="pp-ax v l" id="pp-left" style="grid-column:1;grid-row:2"></div>' +
        '<div class="pp-grid pp-cross" id="pp-grid" role="application" tabindex="0" ' +
             'aria-label="Placement grid. Tap to place, arrow keys to nudge."></div>' +
        '<div class="pp-ax v" id="pp-right" style="grid-column:3;grid-row:2"></div>' +
        '<div class="pp-ax" id="pp-bottom" style="grid-column:2;grid-row:3"></div>' +
      '</div>' +
      '<ul class="pp-tally" id="pp-tally"></ul>' +
      '<div class="pp-foot">' +
        '<input class="pp-in" id="pp-input" maxlength="60" autocomplete="off" hidden>' +
        '<div class="row">' +
          '<button class="btn btn-go" id="pp-a" hidden></button>' +
          '<button class="btn btn-quiet" id="pp-b" hidden></button>' +
        '</div>' +
      '</div>' +
    '</div>';

  ['mode','round','clock','cog','who','item','top','left','right','bottom','grid','tally','input','a','b']
    .forEach(function (k) { el[k] = document.getElementById('pp-' + k); });

  el.grid.addEventListener('pointerdown', onDown);
  el.grid.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', function () { dragging = false; });
  el.grid.addEventListener('keydown', onKey);
  el.cog.addEventListener('click', openSheet);
  el.input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') el.a.click();
  });

  if (!window.__ppTick) {
    window.__ppTick = setInterval(tick, 250);
  }
}

function unmount() {
  if (window.__ppTick) { clearInterval(window.__ppTick); window.__ppTick = null; }
  closeSheet(); closeTile();
  el = {};
  v = null;
}

/* ---------------- placing ---------------- */

function canPlace() {
  return v && v.phase === 'place' && !v.locked[api.me] &&
         !(v.mode === 'clue' && v.isSubmitter);
}

function put(clientX, clientY) {
  if (!canPlace()) return;
  var r = el.grid.getBoundingClientRect();
  var x = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  var y = Math.max(0, Math.min(1, (clientY - r.top) / r.height));
  api.send('place', { x: x, y: y });
}

function onDown(e) { dragging = true; el.grid.focus(); put(e.clientX, e.clientY); }
function onMove(e) { if (dragging) put(e.clientX, e.clientY); }

function onKey(e) {
  if (!canPlace()) return;
  var mine = v.placements[api.me] || { x: 0.5, y: 0.5 };
  var step = e.shiftKey ? 0.1 : 0.02, moved = true;
  if (e.key === 'ArrowLeft') mine = { x: mine.x - step, y: mine.y };
  else if (e.key === 'ArrowRight') mine = { x: mine.x + step, y: mine.y };
  else if (e.key === 'ArrowUp') mine = { x: mine.x, y: mine.y - step };
  else if (e.key === 'ArrowDown') mine = { x: mine.x, y: mine.y + step };
  else if (e.key === 'Enter' || e.key === ' ') { el.a.click(); return; }
  else moved = false;
  if (!moved) return;
  e.preventDefault();
  api.send('place', { x: Math.max(0, Math.min(1, mine.x)), y: Math.max(0, Math.min(1, mine.y)) });
}

/* ---------------- render ---------------- */

function render(view) {
  v = view;
  var host = api.isHost;
  var sub = api.player(v.submitterId);

  el.mode.textContent = MODE_NAME[v.mode];
  el.round.textContent = v.roundNo ? 'Round ' + (v.phase === 'reveal' ? v.roundNo : v.roundNo + 1) : 'Round 1';
  el.cog.hidden = !host;

  el.top.textContent = v.axes.top;
  el.bottom.textContent = v.axes.bottom;
  el.left.textContent = v.axes.left;
  el.right.textContent = v.axes.right;

  /* --- the line above the grid --- */
  if (v.phase === 'submit') {
    if (v.mode === 'clue') {
      el.who.textContent = v.isSubmitter
        ? 'The grid picked a spot. Only you can see it.'
        : (sub ? sub.name + ' is thinking of something' : 'Waiting');
      el.item.textContent = v.isSubmitter ? 'Name something that belongs there' : '…';
    } else {
      el.who.textContent = v.isSubmitter ? 'Your turn' : (sub ? sub.name + ' is choosing' : 'Waiting');
      el.item.textContent = v.isSubmitter ? 'Name anything' : '…';
    }
  } else {
    el.who.textContent = v.mode === 'clue'
      ? (sub ? sub.name + ' says it belongs here' : '')
      : (sub ? sub.name + ' said' : '');
    el.item.textContent = v.item;
  }

  renderGrid();
  renderTally();
  renderClock();
  renderFoot(host);
}

function pct(n) { return (n * 100) + '%'; }

function renderGrid() {
  el.grid.innerHTML = '';

  v.marks.forEach(function (m) {
    var d = h('div', 'pp-mark');
    d.style.left = pct(m.x); d.style.top = pct(m.y);
    d.appendChild(h('i'));
    d.appendChild(h('span', null, m.label));
    el.grid.appendChild(d);
  });

  if (v.secret) {
    var t = h('div', 'pp-target', v.phase === 'reveal' ? '◎' : '◉');
    t.style.left = pct(v.secret.x); t.style.top = pct(v.secret.y);
    t.style.color = v.phase === 'reveal' ? 'var(--lime)' : 'var(--sky)';
    el.grid.appendChild(t);
  }

  if (v.average) {
    var a = h('div', 'pp-avg');
    a.style.left = pct(v.average.x); a.style.top = pct(v.average.y);
    el.grid.appendChild(a);
  }

  Object.keys(v.placements).forEach(function (pid) {
    var p = api.player(pid); if (!p) return;
    var pos = v.placements[pid];
    var d = h('div', 'pp-dot' + (pid === api.me ? ' me' : '') + (pid === v.outlierId ? ' out' : ''));
    d.style.left = pct(pos.x); d.style.top = pct(pos.y);
    d.style.background = p.colour;
    if (p.avatar) { var im = new Image(); im.src = p.avatar; im.alt = ''; d.appendChild(im); }
    else d.textContent = p.name.slice(0, 1).toUpperCase();
    d.title = p.name;
    el.grid.appendChild(d);
  });
}

function renderTally() {
  el.tally.innerHTML = '';
  api.players.forEach(function (p) {
    if (v.mode === 'clue' && p.id === v.submitterId && v.phase !== 'reveal') return;
    var li = h('li');
    var i = h('i'); i.style.background = p.colour; li.appendChild(i);
    var label = p.name;
    if (v.phase === 'reveal' && v.roundScores[p.id] != null) label += ' +' + v.roundScores[p.id];
    else if (v.phase === 'place' && v.locked[p.id]) label += ' ✓';
    li.appendChild(h('span', null, label));
    if (v.totals[p.id]) { var b = h('b', null, v.totals[p.id]); li.appendChild(b); }
    el.tally.appendChild(li);
  });
}

function renderClock() {
  if (!v.endsAt || v.phase !== 'place') { el.clock.hidden = true; return; }
  el.clock.hidden = false;
  var left = Math.max(0, Math.ceil((v.endsAt - api.serverNow()) / 1000));
  el.clock.textContent = left + 's';
}

function tick() { if (v) renderClock(); }

function renderFoot(host) {
  el.input.hidden = true; el.a.hidden = true; el.b.hidden = true;

  if (v.phase === 'submit') {
    if (v.isSubmitter) {
      el.input.hidden = false;
      el.input.placeholder = v.mode === 'clue' ? 'Something that belongs on that spot' : 'Anything at all';
      el.a.hidden = false;
      el.a.textContent = 'Send it to the grid';
      el.a.onclick = function () {
        var t = el.input.value.trim();
        if (!t) return;
        api.send('submitItem', t);
        el.input.value = '';
      };
    }
    if (host) { el.b.hidden = false; el.b.textContent = 'End game'; el.b.onclick = endGame; }
    return;
  }

  if (v.phase === 'place') {
    var mine = !!v.placements[api.me];
    var locked = !!v.locked[api.me];
    if (!(v.mode === 'clue' && v.isSubmitter)) {
      el.a.hidden = false;
      el.a.disabled = !mine || locked;
      el.a.textContent = locked ? 'Locked in — waiting'
        : mine ? 'Lock it in' : 'Tap the grid to place';
      el.a.onclick = function () { api.send('lockIn'); };
    } else {
      el.a.hidden = false;
      el.a.disabled = true;
      el.a.textContent = 'Talk. Do not point.';
    }
    if (host) {
      el.b.hidden = false;
      el.b.textContent = 'Reveal now (' + v.lockedCount + '/' + v.needCount + ')';
      el.b.onclick = function () { api.send('revealNow'); };
    }
    return;
  }

  // reveal
  el.a.hidden = false;
  el.a.disabled = !(host || v.isSubmitter);
  el.a.textContent = (host || v.isSubmitter) ? 'Next round' : 'Waiting for the next round';
  el.a.onclick = function () { api.send('nextRound'); };
  el.b.hidden = false;
  el.b.textContent = 'Save the board';
  el.b.onclick = makeTile;
}

/* ---------------- settings sheet ---------------- */

var sheet = null;

function openSheet() {
  closeSheet();
  sheet = h('div', 'pp-sheet');
  var card = h('div', 'pp-card');

  var head = h('div', 'pp-head');
  head.appendChild(h('h2', null, 'Settings'));
  var x = h('button', 'pp-cog', '✕'); x.onclick = closeSheet;
  head.appendChild(x);
  card.appendChild(head);

  card.appendChild(h('h2', 'h2', 'The grid'));
  var mini = h('div', 'pp-mini');
  var inputs = {};
  [['top','Top'],['bottom','Bottom'],['left','Left'],['right','Right']].forEach(function (pair) {
    var lab = h('label', 'field');
    lab.appendChild(h('span', null, pair[1]));
    var i = h('input'); i.value = v.axes[pair[0]]; i.maxLength = 24;
    inputs[pair[0]] = i; lab.appendChild(i);
    mini.appendChild(lab);
  });
  card.appendChild(mini);

  var save = h('button', 'btn btn-lime', 'Save the axes');
  save.onclick = function () {
    api.send('setAxes', {
      top: inputs.top.value, bottom: inputs.bottom.value,
      left: inputs.left.value, right: inputs.right.value,
    });
    closeSheet();
  };
  card.appendChild(save);

  var chips = h('div', 'pp-chips'); chips.style.marginTop = '.6rem';
  v.presets.forEach(function (p) {
    var c = h('button', 'pp-chip', p.top + ' / ' + p.bottom);
    c.onclick = function () { api.send('setAxes', p); closeSheet(); };
    chips.appendChild(c);
  });
  card.appendChild(chips);

  card.appendChild(h('h2', 'h2', 'How you play'));
  ['live','reveal','clue'].forEach(function (m) {
    var b = h('button', 'gcard' + (v.mode === m ? ' on' : ''));
    var d = h('div');
    d.appendChild(h('strong', null, MODE_NAME[m]));
    d.appendChild(h('em', null, m === 'live'
      ? 'Every dot moves in real time. No secrets.'
      : m === 'reveal'
        ? 'Place in secret against the clock, then everything drops at once.'
        : 'The grid picks a spot. Someone names a thing that belongs there. Everyone else guesses.'));
    b.appendChild(d);
    b.style.width = '100%'; b.style.marginBottom = '.5rem';
    b.disabled = v.phase !== 'submit';
    b.onclick = function () { api.send('setMode', m); closeSheet(); };
    card.appendChild(b);
  });
  card.appendChild(h('p', 'pp-warn', v.phase === 'submit'
    ? 'Switching mode wipes the board and the scores.'
    : 'Finish the round before switching mode.'));

  card.appendChild(h('h2', 'h2', 'Countdown length'));
  var cd = h('div', 'pp-chips');
  [15,30,45,60,90].forEach(function (n) {
    var c = h('button', 'pp-chip' + (v.countdownSeconds === n ? ' on' : ''), n + 's');
    c.onclick = function () { api.send('setCountdown', n); closeSheet(); };
    cd.appendChild(c);
  });
  card.appendChild(cd);

  card.appendChild(h('h2', 'h2', 'The board'));
  var clr = h('button', 'btn', 'Clear every mark');
  clr.onclick = function () { api.send('clearMarks'); closeSheet(); };
  card.appendChild(clr);
  card.appendChild(h('p', 'pp-warn', 'Past rounds stay on the grid until you clear them.'));

  var end = h('button', 'btn btn-quiet', 'End game and show scores');
  end.style.marginTop = '.8rem';
  end.onclick = function () { closeSheet(); endGame(); };
  card.appendChild(end);

  sheet.appendChild(card);
  sheet.addEventListener('click', function (e) { if (e.target === sheet) closeSheet(); });
  document.body.appendChild(sheet);
}

function closeSheet() {
  if (sheet && sheet.parentNode) sheet.parentNode.removeChild(sheet);
  sheet = null;
}

function endGame() { api.send('endGame'); }

/* ---------------- tile export ----------------
   Blob URLs, not data URLs — Safari silently drops data URLs past a size. */

function makeTile() {
  try {
    var S = 1080, PAD = 96;
    var c = document.createElement('canvas');
    c.width = S; c.height = S;
    var g = c.getContext('2d');

    g.fillStyle = '#140C2E'; g.fillRect(0, 0, S, S);
    var box = S - PAD * 2;
    g.fillStyle = '#221645';
    g.fillRect(PAD, PAD, box, box);
    g.strokeStyle = '#382A69'; g.lineWidth = 4;
    g.strokeRect(PAD, PAD, box, box);
    g.beginPath();
    g.moveTo(PAD, PAD + box / 2); g.lineTo(PAD + box, PAD + box / 2);
    g.moveTo(PAD + box / 2, PAD); g.lineTo(PAD + box / 2, PAD + box);
    g.stroke();

    g.fillStyle = '#9C90C9';
    g.font = '600 30px Archivo, sans-serif';
    g.textAlign = 'center';
    g.fillText(v.axes.top, S / 2, PAD - 26);
    g.fillText(v.axes.bottom, S / 2, S - PAD + 50);
    g.save();
    g.translate(PAD - 30, S / 2); g.rotate(-Math.PI / 2);
    g.fillText(v.axes.left, 0, 0); g.restore();
    g.save();
    g.translate(S - PAD + 46, S / 2); g.rotate(Math.PI / 2);
    g.fillText(v.axes.right, 0, 0); g.restore();

    g.font = '600 22px Archivo, sans-serif';
    v.marks.forEach(function (m) {
      var x = PAD + m.x * box, y = PAD + m.y * box;
      g.fillStyle = '#C8F53C';
      g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#FFF3DE';
      g.fillText(m.label, x, y - 16);
    });

    g.textAlign = 'left';
    g.fillStyle = '#FF3F6C';
    g.font = '400 40px "Archivo Black", Archivo, sans-serif';
    g.fillText('Bingo', PAD, S - 24);
    var w = g.measureText('Bingo ').width;
    g.fillStyle = '#C8F53C';
    g.fillText('Bango', PAD + w, S - 24);

    c.toBlob(function (blob) {
      if (!blob) return api.banner('Could not build that image', 'warn');
      if (tileUrl) URL.revokeObjectURL(tileUrl);
      tileUrl = URL.createObjectURL(blob);
      showTile(tileUrl);
    }, 'image/png');
  } catch (err) {
    api.banner('Could not build that image', 'warn');
  }
}

var tileBox = null;

function showTile(url) {
  closeTile();
  tileBox = h('div', 'pp-tile');
  var im = new Image(); im.src = url; im.alt = 'The board so far';
  tileBox.appendChild(im);
  tileBox.appendChild(h('p', 'tiny dim', 'Press and hold the image to save it to your photos.'));
  var dl = document.createElement('a');
  dl.className = 'btn btn-lime'; dl.href = url; dl.download = 'bingo-bango.png';
  dl.textContent = 'Download'; dl.style.textAlign = 'center'; dl.style.textDecoration = 'none';
  tileBox.appendChild(dl);
  var cl = h('button', 'btn btn-quiet', 'Close');
  cl.onclick = closeTile;
  tileBox.appendChild(cl);
  document.body.appendChild(tileBox);
}

function closeTile() {
  if (tileBox && tileBox.parentNode) tileBox.parentNode.removeChild(tileBox);
  tileBox = null;
}

/* ---------------- register ---------------- */

window.BingoBango.registerGame({
  id: 'plotparty',
  mount: mount,
  render: render,
  unmount: unmount,
});

})();
