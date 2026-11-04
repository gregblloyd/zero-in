'use strict';
/* Zero In — offline sight-in + reloading log. All data stays on this phone (localStorage). */

// ---------- storage ----------
const KEY = 'zeroin.v1';
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const defaultRifle = () => ({
  id: uid(), name: 'My Rifle', caliber: '', barrel: '', twist: '', scope: '', unit: 'MOA', click: 0.25,
  moaType: 'true', elevTurn: 'arrow', windTurn: 'arrow', zeroDist: 100, distUnit: 'yd', zeroOffset: 0,
  sightHeight: '', notes: ''
});
function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.rifles) return s; } catch (e) {}
  const r = Object.assign(defaultRifle(), {
    name: 'Fierce Twisted XP', caliber: '7mm PRC', barrel: '20" (short, for the can) · 1:8 twist',
    scope: 'Athlon 6-24x50 · Vortex rings', unit: 'MOA', click: 0.25, moaType: 'true', elevTurn: 'ccw', windTurn: 'ccw',
    zeroDist: 100, distUnit: 'yd', zeroOffset: 0,
    notes: 'SilencerCo Scythe Ti suppressor. Zero with the can ON — taking it off moves point of impact.\nScope: 1 click = 1/4 MOA = 0.26" at 100 yd.\nCheck ring and base screws are torqued before every sight-in.'
  });
  return { rifles: [r], activeRifle: r.id, groups: [], loads: [], settings: { theme: 'dark', range: 6 } };
}
let S = load();
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast('Could not save. Phone storage is full?'); } }
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

let DATA = null;
fetch('data.json').then(r => r.json()).then(d => { DATA = d; if (tab === 'data' || tab === 'loads') render(); }).catch(() => { DATA = false; });

// ---------- helpers ----------
const $ = (s, el = document) => el.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const f = (n, d = 2) => (n == null || isNaN(n)) ? '–' : Number(n).toFixed(d);
const num = v => { const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? null : n; };
const rifle = () => S.rifles.find(r => r.id === S.activeRifle) || S.rifles[0];
function toast(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t);
  setTimeout(() => t.remove(), 2400);
}
function applyTheme() { document.documentElement.dataset.theme = S.settings.theme; }
applyTheme();

// ---------- the math ----------
// Inches one click moves the bullet at the given distance.
function inchesPerClick(r, dist, distUnit) {
  const yards = distUnit === 'm' ? dist * 1.0936133 : dist;
  const perUnitAt100 = r.unit === 'MIL' ? 3.6 : (r.moaType === 'iphy' ? 1.0 : 1.047198);
  return r.click * perUnitAt100 * yards / 100;
}
function unitsPerInch(r, dist, distUnit) { return 1 / (inchesPerClick(r, dist, distUnit) / r.click); } // MOA or MIL per inch
function groupStats(shots) {
  if (!shots.length) return null;
  const cx = shots.reduce((a, s) => a + s.x, 0) / shots.length;
  const cy = shots.reduce((a, s) => a + s.y, 0) / shots.length;
  let es = 0;
  for (let i = 0; i < shots.length; i++) for (let j = i + 1; j < shots.length; j++)
    es = Math.max(es, Math.hypot(shots[i].x - shots[j].x, shots[i].y - shots[j].y));
  return { cx, cy, es, n: shots.length };
}
// Correction to move the group center to the wanted point of impact.
function correction(r, cx, cy, dist, distUnit) {
  const ipc = inchesPerClick(r, dist, distUnit);
  const needUp = (r.zeroOffset || 0) - cy, needRight = 0 - cx;
  return {
    ipc,
    elev: { inches: needUp, clicks: Math.round(needUp / ipc), exact: needUp / ipc, dir: needUp >= 0 ? 'UP' : 'DOWN' },
    wind: { inches: needRight, clicks: Math.round(needRight / ipc), exact: needRight / ipc, dir: needRight >= 0 ? 'RIGHT' : 'LEFT' },
  };
}
function stats(vals) {
  const v = vals.filter(x => x != null && !isNaN(x));
  if (!v.length) return null;
  const avg = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = v.length > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - avg) ** 2, 0) / (v.length - 1)) : 0;
  return { n: v.length, avg, sd, es: Math.max(...v) - Math.min(...v), min: Math.min(...v), max: Math.max(...v) };
}
const clickLabel = r => r.unit === 'MIL' ? `${r.click} MIL` : `${fracMoa(r.click)} MOA`;
function fracMoa(c) { return ({ 0.125: '1/8', 0.25: '1/4', 0.5: '1/2', 1: '1' })[c] || c; }
// Which way to physically spin the cap. Standard scopes: counter-clockwise moves hits UP (looking down
// at the top turret) and RIGHT (looking at the side turret from the right side of the rifle).
function turnDir(r, axis, dir) {
  let base = axis === 'elev' ? r.elevTurn : r.windTurn;
  if (base !== 'cw') base = 'ccw';
  const pos = dir === 'UP' || dir === 'RIGHT';
  return pos ? base : (base === 'cw' ? 'ccw' : 'cw');
}
const turnWord = t => t === 'ccw' ? 'LEFT' : 'RIGHT';
const turnLong = t => t === 'ccw' ? 'counter‑clockwise, like opening a jar' : 'clockwise, like closing a jar';
function rotSvg(t) {
  // circular arrow; mirrored for clockwise
  return `<svg viewBox="0 0 48 48" style="${t === 'cw' ? 'transform:scaleX(-1)' : ''}" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M40 24A16 16 0 1 0 24 40"/><path d="M16 32l8 8-8 8"/></svg>`;
}

// ---------- routing ----------
let tab = 'zero';
let shots = [];          // current group on the target
let zeroMode = 'tap';     // 'tap' | 'type'
let manual = { up: '', upDir: 'low', side: '', sideDir: 'right' };
let dist = null, distUnit = null;
let dataCart = '223', dataSec = 'bullets', dataQ = '';
let openLoad = null;

document.getElementById('nav').addEventListener('click', e => {
  const b = e.target.closest('button[data-tab]'); if (!b) return;
  tab = b.dataset.tab; openLoad = null;
  document.querySelectorAll('#nav button').forEach(x => x.classList.toggle('on', x === b));
  render(); window.scrollTo(0, 0);
});
function netState() {
  const el = $('#netstate');
  el.textContent = navigator.onLine ? '' : '● OFFLINE — still works';
  el.className = 'offline' + (navigator.onLine ? ' no' : '');
}
addEventListener('online', netState); addEventListener('offline', netState); netState();

function render() {
  const v = $('#view');
  ({ zero: renderZero, rifles: renderRifles, loads: renderLoads, data: renderData, more: renderMore })[tab](v);
}

// ---------- ZERO ----------
function renderZero(v) {
  const r = rifle();
  if (dist == null) { dist = r.zeroDist || 100; distUnit = r.distUnit || 'yd'; }
  const R = S.settings.range || 6;
  let st = null, corr = null;
  if (zeroMode === 'tap') { st = groupStats(shots); if (st) corr = correction(r, st.cx, st.cy, dist, distUnit); }
  else {
    const up = num(manual.up), side = num(manual.side);
    if (up != null || side != null) {
      const cy = (up || 0) * (manual.upDir === 'high' ? 1 : -1);
      const cx = (side || 0) * (manual.sideDir === 'right' ? 1 : -1);
      corr = correction(r, cx, cy, dist, distUnit); st = { cx, cy, n: 0, es: 0 };
    }
  }
  const myGroups = S.groups.filter(g => g.rifleId === r.id);
  S.sessions = S.sessions || {};
  let curSess = S.sessions[r.id];
  const lastG = myGroups[myGroups.length - 1];
  if (!curSess || (lastG && lastG.session === curSess && Date.now() - lastG.ts > 8 * 3600e3)) { curSess = S.sessions[r.id] = uid(); save(); }
  const sessGroups = myGroups.filter(g => g.session === curSess);
  const totE = sessGroups.reduce((a, g) => a + g.elevClicks, 0), totW = sessGroups.reduce((a, g) => a + g.windClicks, 0);

  v.innerHTML = `
  <div class="card" style="padding:12px">
    <div class="row">
      <div style="flex:1.6"><label>Rifle</label><select id="rsel">${S.rifles.map(x => `<option value="${x.id}" ${x.id === r.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
      <div><label>Distance</label><div style="position:relative"><input id="dist" class="num" inputmode="decimal" value="${dist}" style="padding-right:38px"><button id="du" style="position:absolute;right:4px;top:4px;bottom:4px;border:0;border-radius:8px;background:var(--panel);color:var(--accent);font-weight:700;width:34px">${distUnit}</button></div></div>
    </div>
    <div class="tiny" id="clickinfo" style="margin-top:8px">${clickInfo(r)}</div>
  </div>

  <div class="seg" id="mode" style="margin-bottom:10px"><button data-m="tap" class="${zeroMode === 'tap' ? 'on' : ''}">Tap the target</button><button data-m="type" class="${zeroMode === 'type' ? 'on' : ''}">Type it in</button></div>

  ${zeroMode === 'tap' ? `
    <div class="target-wrap" id="tgt">${targetSvg(R, st, r)}</div>
    <div class="tiny" style="margin-top:6px">Aim at the center. Tap where each bullet hit. Grid squares are 1 inch.</div>
    <div class="tool">
      <button class="btn small" id="undo" ${shots.length ? '' : 'disabled'}>↶ Undo</button>
      <button class="btn small" id="clear" ${shots.length ? '' : 'disabled'}>Clear</button>
      <div class="seg" id="zoom" style="flex:1.4">${[3, 6, 12].map(z => `<button data-z="${z}" class="${R === z ? 'on' : ''}">±${z}"</button>`).join('')}</div>
    </div>` : `
    <div class="card">
      <div class="field"><label>How far is the group from the bullseye — up/down? (inches)</label>
        <div class="row"><input id="mUp" class="num" inputmode="decimal" placeholder="0" value="${esc(manual.up)}">
        <div class="seg" id="mUpDir"><button data-d="low" class="${manual.upDir === 'low' ? 'on' : ''}">Low</button><button data-d="high" class="${manual.upDir === 'high' ? 'on' : ''}">High</button></div></div></div>
      <div class="field" style="margin:0"><label>Left/right? (inches)</label>
        <div class="row"><input id="mSide" class="num" inputmode="decimal" placeholder="0" value="${esc(manual.side)}">
        <div class="seg" id="mSideDir"><button data-d="left" class="${manual.sideDir === 'left' ? 'on' : ''}">Left</button><button data-d="right" class="${manual.sideDir === 'right' ? 'on' : ''}">Right</button></div></div></div>
    </div>`}

  <div id="quick">${quickHtml(corr)}</div>
  <div id="answer">${answerHtml(r, st, corr)}</div>

  ${corr ? `<button class="btn primary block" id="dialed" style="margin-top:12px">I dialed it — next group</button>` : ''}

  ${sessGroups.length ? `<h2>This session</h2><div class="card">
    ${sessGroups.map((g, i) => `<div class="stat"><span>Group ${i + 1}${g.n ? ` · ${g.n} shots, ${f(g.es, 2)}"` : ''}</span><span class="num">${dirTxt(g.elevClicks, 'UP', 'DOWN')} · ${dirTxt(g.windClicks, 'RIGHT', 'LEFT')}</span></div>`).join('')}
    <div class="stat"><b>Total dialed</b><b class="num">${dirTxt(totE, 'UP', 'DOWN')} · ${dirTxt(totW, 'RIGHT', 'LEFT')}</b></div>
    <button class="btn small" id="newsess" style="margin-top:8px">Start new session</button>
  </div>` : ''}
  `;

  $('#rsel').onchange = e => { S.activeRifle = e.target.value; save(); dist = null; shots = []; render(); };
  $('#clickinfo').onclick = e => { if (e.target.id === 'setup') { e.preventDefault(); editRifle(rifle()); } };
  $('#dist').oninput = e => { const n = num(e.target.value); if (n && n > 0) { dist = n; refreshAnswer(); } };
  $('#du').onclick = () => { distUnit = distUnit === 'yd' ? 'm' : 'yd'; render(); };
  $('#quick').onclick = () => $('#answer').scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('#mode').onclick = e => { const b = e.target.closest('button'); if (!b) return; zeroMode = b.dataset.m; render(); };
  if (zeroMode === 'tap') {
    $('#tgt').addEventListener('click', e => {
      const svg = $('#tgt svg'); const rc = svg.getBoundingClientRect();
      const x = ((e.clientX - rc.left) / rc.width) * 2 * R - R;
      const y = -(((e.clientY - rc.top) / rc.height) * 2 * R - R);
      shots.push({ x: Math.round(x * 20) / 20, y: Math.round(y * 20) / 20 });
      if (navigator.vibrate) navigator.vibrate(15);
      render();
    });
    $('#undo').onclick = () => { shots.pop(); render(); };
    $('#clear').onclick = () => { shots = []; render(); };
    $('#zoom').onclick = e => { const b = e.target.closest('button'); if (!b) return; S.settings.range = +b.dataset.z; save(); render(); };
  } else {
    $('#mUp').oninput = e => { manual.up = e.target.value; refreshAnswer(); };
    $('#mSide').oninput = e => { manual.side = e.target.value; refreshAnswer(); };
    $('#mUpDir').onclick = e => { const b = e.target.closest('button'); if (!b) return; manual.upDir = b.dataset.d; render(); };
    $('#mSideDir').onclick = e => { const b = e.target.closest('button'); if (!b) return; manual.sideDir = b.dataset.d; render(); };
  }
  const dl = $('#dialed');
  if (dl) dl.onclick = () => {
    S.groups.push({ id: uid(), session: curSess, ts: Date.now(), rifleId: r.id, dist, distUnit, shots: zeroMode === 'tap' ? shots.slice() : [],
      n: st.n, es: st.es, cx: st.cx, cy: st.cy, elevClicks: corr.elev.clicks, windClicks: corr.wind.clicks });
    save(); shots = []; manual.up = ''; manual.side = '';
    toast('Saved. Shoot your next group.'); render(); window.scrollTo(0, 0);
  };
  const ns = $('#newsess'); if (ns) ns.onclick = () => { S.sessions[r.id] = uid(); save(); shots = []; render(); toast('New session started'); };
  function refreshAnswer() {
    // keep focus in the input while typing: update only the answer + click size
    const rr = rifle(); let s2 = null, c2 = null;
    if (zeroMode === 'tap') { s2 = groupStats(shots); if (s2) c2 = correction(rr, s2.cx, s2.cy, dist, distUnit); }
    else { const up = num(manual.up), side = num(manual.side);
      if (up != null || side != null) { const cy = (up || 0) * (manual.upDir === 'high' ? 1 : -1), cx = (side || 0) * (manual.sideDir === 'right' ? 1 : -1); c2 = correction(rr, cx, cy, dist, distUnit); s2 = { cx, cy, n: 0, es: 0 }; } }
    $('#answer').innerHTML = answerHtml(rr, s2, c2); $('#quick').innerHTML = quickHtml(c2);
    $('#clickinfo').innerHTML = clickInfo(rr);
    const had = !!$('#dialed'); if (had !== !!c2) render();
  }
}
function clickInfo(r) { return `${esc(r.scope || 'Scope not set')} · <b>${clickLabel(r)}</b>/click = <b class="num">${f(inchesPerClick(r, dist, distUnit), 3)}"</b> at ${dist} ${distUnit}${r.zeroOffset ? ` · zero ${f(Math.abs(r.zeroOffset), 1)}" ${r.zeroOffset > 0 ? 'high' : 'low'}` : ''}${!r.scope ? ` · <a href="#" id="setup" style="color:var(--accent)">Set up rifle</a>` : ''}`; }
const bulletLabel = b => { const n = b.name.startsWith(b.maker) ? b.name : `${b.maker} ${b.name}`; return /\d\s*gr\b/i.test(n) ? n : `${n} ${b.weightGr}gr`; };
const primerLabel = p => { const m = p.model || p.name; return m.startsWith(p.maker) ? m : `${p.maker} ${m}`; };
const dirTxt = (c, pos, neg) => c === 0 ? '0' : `${c > 0 ? pos : neg} ${Math.abs(c)}`;
function arrowSvg(dir) {
  const rot = { UP: 0, RIGHT: 90, DOWN: 180, LEFT: 270 }[dir];
  return `<svg viewBox="0 0 24 24" style="transform:rotate(${rot}deg)" fill="currentColor"><path d="M12 3l7 9h-4.5v9h-5v-9H5z"/></svg>`;
}
function quickHtml(c) {
  if (!c) return '';
  const r = rifle(), u = r.unit === 'MIL' ? 'MIL' : 'MOA', upi = unitsPerInch(r, dist, distUnit);
  const ar = { UP: '▲', DOWN: '▼', LEFT: '◀', RIGHT: '▶' };
  const part = (ax, x) => { if (x.clicks === 0) return `<span><small>${ax === 'elev' ? 'ELEVATION' : 'WINDAGE'}</small><b>✓ good</b><small>no change</small></span>`;
    const t = turnDir(r, ax, x.dir);
    return `<span><small>${ar[x.dir]} ${x.dir}</small><b>${f(Math.abs(x.inches * upi), 2)} ${u}</b><small>turn ${turnWord(t).toLowerCase()} ${Math.abs(x.clicks)} clicks</small></span>`; };
  return `<div class="quick">${part('elev', c.elev)}${part('wind', c.wind)}</div>`;
}
function answerHtml(r, st, corr) {
  if (!corr) return `<div class="card empty">${zeroMode === 'tap' ? 'Shoot a 3‑shot group at the center, then tap each hole.' : 'Enter how far the group center is from the bullseye.'}</div>`;
  const u = r.unit === 'MIL' ? 'MIL' : 'MOA';
  const upi = unitsPerInch(r, dist, distUnit);
  const zeroed = corr.elev.clicks === 0 && corr.wind.clicks === 0;
  const card = (ax, c, label) => {
    const ok = c.clicks === 0;
    if (ok) return `<div class="dial ok"><div class="k">${label}</div><div class="clicks" style="color:var(--good)">✓</div><div class="dir" style="font-size:18px">No change</div><div class="sub num">${f(Math.abs(c.inches * upi), 2)} ${u} · under 1 click</div></div>`;
    const t = turnDir(r, ax, c.dir);
    return `<div class="dial">
      <div class="k">${label}</div>
      <div class="dir">${arrowSvg(c.dir)}<span>${c.dir}</span></div>
      <div class="clicks num">${f(Math.abs(c.inches * upi), 2)}</div>
      <div class="unit">${u}</div>
      <div class="turn">${rotSvg(t)}<span>turn ${turnWord(t).toLowerCase()} <b class="num">${Math.abs(c.clicks)}</b> clicks</span></div>
      <div class="sub num">${f(Math.abs(c.inches), 2)}" at ${dist} ${distUnit}</div>
    </div>`;
  };
  return `
    ${zeroed ? `<div class="card" style="border-color:var(--good);text-align:center"><b style="color:var(--good);font-size:20px">✓ ZEROED</b><div class="muted">Group center is within a click. Confirm with one more group, then set your turret caps to 0.</div></div>` : ''}
    <div class="answer">${card('elev', corr.elev, 'ELEVATION')}${card('wind', corr.wind, 'WINDAGE')}</div>
    ${zeroed ? '' : `<div class="how">
      ${[['elev', 'Elevation', corr.elev], ['wind', 'Windage', corr.wind]].filter(x => x[2].clicks).map(([ax, name, c], i) => { const t = turnDir(r, ax, c.dir); const m = Math.abs(c.inches * upi);
        return `<div style="${i ? 'margin-top:8px' : ''}"><b>${name}:</b> ${f(m, 2)} ${u} ${c.dir.toLowerCase()}. ${f(m, 2)} ÷ ${r.unit === 'MIL' ? r.click : fracMoa(r.click)} ${u} per click = ${f(Math.abs(c.exact), 1)} → <b>${Math.abs(c.clicks)} clicks</b>. Turn it <b>${turnWord(t).toLowerCase()}</b> (${t === 'ccw' ? 'counter‑clockwise' : 'clockwise'}).</div>`; }).join('')}
      <div class="tiny" style="margin-top:10px">Keep the crosshair on the bullseye for the next group. The turret moves where the bullets land, not where you aim.</div>
    </div>`}
    ${st && st.n ? `<div class="card" style="margin-top:10px">
      <div class="stat"><span>Shots</span><span class="num">${st.n}</span></div>
      <div class="stat"><span>Group center</span><span class="num">${f(Math.abs(st.cy), 2)}" ${st.cy >= 0 ? 'high' : 'low'}, ${f(Math.abs(st.cx), 2)}" ${st.cx >= 0 ? 'right' : 'left'}</span></div>
      ${st.n > 1 ? `<div class="stat"><span>Group size (c‑c)</span><span class="num">${f(st.es, 2)}" · ${f(st.es * upi, 2)} ${u}</span></div>` : ''}
    </div>` : ''}`;
}
function targetSvg(R, st, r) {
  let g = '';
  const step = R <= 3 ? 0.5 : 1;
  for (let i = -R; i <= R + 1e-9; i += step) {
    const major = Math.abs(i % 1) < 1e-9;
    const w = Math.abs(i) < 1e-9 ? 0.05 * R / 6 : (major ? 0.022 * R / 6 : 0.012 * R / 6);
    const c = Math.abs(i) < 1e-9 ? '#888' : 'var(--target-line)';
    g += `<line x1="${i}" y1="${-R}" x2="${i}" y2="${R}" stroke="${c}" stroke-width="${w}"/><line x1="${-R}" y1="${i}" x2="${R}" y2="${i}" stroke="${c}" stroke-width="${w}"/>`;
  }
  let labels = '';
  const lstep = R >= 12 ? 3 : (R >= 6 ? 2 : 1);
  for (let i = lstep; i < R; i += lstep) labels += `<text x="${i}" y="${R * 0.06}" font-size="${R * 0.055}" fill="#888" text-anchor="middle">${i}"</text><text x="${-R * 0.03}" y="${-i + R * 0.02}" font-size="${R * 0.055}" fill="#888" text-anchor="end">${i}"</text>`;
  const s = R / 6; // scale marks
  const bull = `<circle r="1" fill="none" stroke="#222" stroke-width="${0.05 * s}"/><circle r="0.5" fill="#222"/><circle r="0.12" fill="#f3f1ea"/>`;
  const want = r.zeroOffset ? `<g transform="translate(0 ${-r.zeroOffset})"><circle r="${0.35 * s}" fill="none" stroke="var(--good)" stroke-width="${0.06 * s}" stroke-dasharray="${0.12 * s} ${0.08 * s}"/></g>` : '';
  const holes = shots.map((p, i) => `<g transform="translate(${p.x} ${-p.y})"><circle r="${0.3 * s}" fill="var(--shot)" stroke="#fff" stroke-width="${0.04 * s}"/><text y="${0.1 * s}" font-size="${0.3 * s}" fill="#fff" text-anchor="middle" font-weight="700">${i + 1}</text></g>`).join('');
  const ctr = st && st.n ? `<g transform="translate(${st.cx} ${-st.cy})" stroke="var(--center)" stroke-width="${0.07 * s}"><line x1="${-0.5 * s}" x2="${0.5 * s}"/><line y1="${-0.5 * s}" y2="${0.5 * s}"/><circle r="${0.3 * s}" fill="none"/></g>
    <line x1="${st.cx}" y1="${-st.cy}" x2="0" y2="${-(r.zeroOffset || 0)}" stroke="var(--center)" stroke-width="${0.035 * s}" stroke-dasharray="${0.15 * s} ${0.1 * s}"/>` : '';
  return `<svg viewBox="${-R} ${-R} ${2 * R} ${2 * R}" xmlns="http://www.w3.org/2000/svg">${g}${labels}${bull}${want}${ctr}${holes}</svg>`;
}

// ---------- RIFLES ----------
function renderRifles(v) {
  v.innerHTML = `<h2>Your rifles</h2><div class="card">
    ${S.rifles.map(r => `<div class="list-item" data-id="${r.id}"><div class="grow"><div class="t">${esc(r.name)} ${r.id === S.activeRifle ? '<span class="pill acc">active</span>' : ''}</div>
      <div class="muted">${esc([r.caliber, r.scope].filter(Boolean).join(' · ') || 'Tap to set up')}</div>
      <div class="tiny">${clickLabel(r)} clicks · zero ${r.zeroDist} ${r.distUnit}${r.zeroOffset ? `, ${Math.abs(r.zeroOffset)}" ${r.zeroOffset > 0 ? 'high' : 'low'}` : ''}</div></div>
      <button class="btn small" data-edit="${r.id}">Edit</button></div>`).join('')}
  </div>
  <button class="btn primary block" id="addr">+ Add a rifle</button>
  <h2>Zero history</h2><div class="card">${historyHtml()}</div>`;
  v.querySelectorAll('[data-edit]').forEach(b => b.onclick = e => { e.stopPropagation(); editRifle(S.rifles.find(r => r.id === b.dataset.edit)); });
  v.querySelectorAll('.list-item[data-id]').forEach(li => li.onclick = () => { S.activeRifle = li.dataset.id; save(); dist = null; render(); toast('Active rifle set'); });
  $('#addr').onclick = () => editRifle(null);
}
function historyHtml() {
  const by = {};
  S.groups.forEach(g => { (by[g.session] = by[g.session] || []).push(g); });
  const sessions = Object.values(by).sort((a, b) => b[0].ts - a[0].ts).slice(0, 20);
  if (!sessions.length) return `<div class="empty">No sight‑in sessions yet.</div>`;
  return sessions.map(gs => {
    const r = S.rifles.find(x => x.id === gs[0].rifleId);
    const e = gs.reduce((a, g) => a + g.elevClicks, 0), w = gs.reduce((a, g) => a + g.windClicks, 0);
    return `<div class="stat"><span>${new Date(gs[0].ts).toLocaleDateString()} · ${esc(r ? r.name : '?')} · ${gs.length} groups</span><span class="num">${dirTxt(e, 'UP', 'DOWN')} · ${dirTxt(w, 'R', 'L')}</span></div>`;
  }).join('');
}
const CLICKS = [['MOA', 0.25, '1/4 MOA (most common hunting scopes)'], ['MOA', 0.125, '1/8 MOA (target scopes)'], ['MOA', 0.5, '1/2 MOA'], ['MOA', 1, '1 MOA'], ['MIL', 0.1, '0.1 MIL (most mil scopes)'], ['MIL', 0.05, '0.05 MIL']];
function editRifle(r) {
  const isNew = !r; r = r ? { ...r } : defaultRifle(); if (isNew) r.name = '';
  sheet(isNew ? 'Add rifle' : 'Edit rifle', `
    <div class="field"><label>Name</label><input id="f_name" value="${esc(r.name)}" placeholder="e.g. Tikka T3x 7 PRC"></div>
    <div class="grid2"><div class="field"><label>Caliber</label><input id="f_caliber" value="${esc(r.caliber)}" placeholder="7mm PRC"></div>
    <div class="field"><label>Barrel / twist</label><input id="f_barrel" value="${esc(r.barrel)}" placeholder='24" 1:8'></div></div>
    <div class="field"><label>Scope</label><input id="f_scope" value="${esc(r.scope)}" placeholder="e.g. Vortex Razor HD Gen III 6-36x56"></div>
    <div class="field"><label>Click value (printed on the turret)</label>
      <select id="f_click">${CLICKS.map(([u, c, l]) => `<option value="${u}|${c}" ${r.unit === u && r.click === c ? 'selected' : ''}>${l}</option>`).join('')}
      <option value="custom" ${CLICKS.some(([u, c]) => u === r.unit && c === r.click) ? '' : 'selected'}>Other…</option></select></div>
    <div class="grid2" id="customClick" style="${CLICKS.some(([u, c]) => u === r.unit && c === r.click) ? 'display:none' : ''}">
      <div class="field"><label>Unit</label><select id="f_unit"><option ${r.unit === 'MOA' ? 'selected' : ''}>MOA</option><option ${r.unit === 'MIL' ? 'selected' : ''}>MIL</option></select></div>
      <div class="field"><label>Per click</label><input id="f_cv" inputmode="decimal" value="${r.click}"></div></div>
    <div class="field" id="moaRow" style="${r.unit === 'MIL' ? 'display:none' : ''}"><label>MOA type</label>
      <select id="f_moa"><option value="true" ${r.moaType !== 'iphy' ? 'selected' : ''}>True MOA — 1.047" at 100 yd (almost all modern scopes)</option><option value="iphy" ${r.moaType === 'iphy' ? 'selected' : ''}>Shooter's MOA / IPHY — 1.000" at 100 yd (some older scopes)</option></select></div>
    <div class="grid2"><div class="field"><label>Zero distance</label><input id="f_zd" inputmode="decimal" value="${r.zeroDist}"></div>
      <div class="field"><label>&nbsp;</label><select id="f_du"><option value="yd" ${r.distUnit === 'yd' ? 'selected' : ''}>yards</option><option value="m" ${r.distUnit === 'm' ? 'selected' : ''}>meters</option></select></div></div>
    <div class="field"><label>Where you want it to hit at that distance</label>
      <select id="f_zo">${[-1, -0.5, 0, 0.5, 1, 1.5, 2, 2.5, 3].map(o => `<option value="${o}" ${(+r.zeroOffset || 0) === o ? 'selected' : ''}>${o === 0 ? 'Dead center (standard)' : `${Math.abs(o)}" ${o > 0 ? 'high' : 'low'}`}</option>`).join('')}</select></div>
    <details class="field"><summary>Turret direction</summary>
      <div class="tiny" style="margin-bottom:8px">Almost every scope is counter‑clockwise for UP and for RIGHT. To check yours, look at the caps: the arrow next to "UP" (top) and "R" (side) points the way that moves hits up / right.</div>
      <div class="field"><label>Elevation: which way moves hits UP?</label><select id="f_et"><option value="ccw" ${r.elevTurn !== 'cw' ? 'selected' : ''}>Counter‑clockwise, looking down (standard)</option><option value="cw" ${r.elevTurn === 'cw' ? 'selected' : ''}>Clockwise, looking down</option></select></div>
      <div class="field"><label>Windage: which way moves hits RIGHT?</label><select id="f_wt"><option value="ccw" ${r.windTurn !== 'cw' ? 'selected' : ''}>Counter‑clockwise, from the right side (standard)</option><option value="cw" ${r.windTurn === 'cw' ? 'selected' : ''}>Clockwise, from the right side</option></select></div>
    </details>
    <div class="field"><label>Notes</label><textarea id="f_notes" placeholder="Rings, torque specs, ammo it's zeroed with…">${esc(r.notes)}</textarea></div>
    <button class="btn primary block" id="f_save">Save</button>
    ${isNew || S.rifles.length < 2 ? '' : `<button class="btn danger block" id="f_del" style="margin-top:10px">Delete rifle</button>`}
  `, el => {
    const sync = () => { const v = $('#f_click', el).value; $('#customClick', el).style.display = v === 'custom' ? '' : 'none';
      const unit = v === 'custom' ? $('#f_unit', el).value : v.split('|')[0]; $('#moaRow', el).style.display = unit === 'MIL' ? 'none' : ''; };
    $('#f_click', el).onchange = sync; $('#f_unit', el).onchange = sync;
    $('#f_save', el).onclick = () => {
      const cv = $('#f_click', el).value;
      if (cv === 'custom') { r.unit = $('#f_unit', el).value; r.click = num($('#f_cv', el).value) || 0.25; } else { r.unit = cv.split('|')[0]; r.click = +cv.split('|')[1]; }
      Object.assign(r, { name: $('#f_name', el).value.trim() || 'Rifle', caliber: $('#f_caliber', el).value.trim(), barrel: $('#f_barrel', el).value.trim(),
        scope: $('#f_scope', el).value.trim(), moaType: $('#f_moa', el).value, zeroDist: num($('#f_zd', el).value) || 100, distUnit: $('#f_du', el).value,
        zeroOffset: +$('#f_zo', el).value, elevTurn: $('#f_et', el).value, windTurn: $('#f_wt', el).value, notes: $('#f_notes', el).value });
      const i = S.rifles.findIndex(x => x.id === r.id); if (i >= 0) S.rifles[i] = r; else { S.rifles.push(r); S.activeRifle = r.id; }
      save(); dist = null; closeSheet(); render(); toast('Rifle saved');
    };
    const d = $('#f_del', el); if (d) d.onclick = () => { if (!confirm('Delete this rifle?')) return; S.rifles = S.rifles.filter(x => x.id !== r.id); if (S.activeRifle === r.id) S.activeRifle = S.rifles[0].id; save(); closeSheet(); render(); };
  });
}

// ---------- sheet ----------
function sheet(title, html, bind) {
  closeSheet();
  const s = document.createElement('div'); s.className = 'sheet'; s.id = 'sheet';
  s.innerHTML = `<div class="inner"><div class="bar"><h3>${esc(title)}</h3><button class="btn small" id="sx">Close</button></div>${html}</div>`;
  s.addEventListener('click', e => { if (e.target === s) closeSheet(); });
  document.body.appendChild(s); $('#sx', s).onclick = closeSheet; document.body.style.overflow = 'hidden';
  bind && bind(s);
}
function closeSheet() { const s = $('#sheet'); if (s) s.remove(); document.body.style.overflow = ''; }

// ---------- LOADS ----------
const CARTS = [['9mm', '9mm Luger'], ['223', '.223 Rem / 5.56'], ['7prc', '7mm PRC']];
const cartName = id => (CARTS.find(c => c[0] === id) || [id, id])[1];
const STATUS = { workup: 'Working up', keeper: 'Keeper', retired: 'Retired' };
function renderLoads(v) {
  if (openLoad) return renderLoad(v, S.loads.find(l => l.id === openLoad));
  const by = c => S.loads.filter(l => l.cartridge === c);
  v.innerHTML = `
    <div class="warn"><b>Safety:</b> always take charge weights from a current published manual for your exact bullet, powder, and primer. Start at the listed starting load and work up. Stop at the first pressure sign.</div>
    ${CARTS.map(([c, n]) => `<h2>${n}</h2><div class="card">${by(c).length ? by(c).map(loadRow).join('') : `<div class="empty">No ${n} loads yet.</div>`}</div>`).join('')}
    ${S.loads.some(l => !CARTS.some(c => c[0] === l.cartridge)) ? `<h2>Other</h2><div class="card">${S.loads.filter(l => !CARTS.some(c => c[0] === l.cartridge)).map(loadRow).join('')}</div>` : ''}
    <button class="btn primary block" id="addl">+ New load</button>
    <h2>Chrono calculator</h2><div class="card"><label>Paste or type velocities (fps)</label><textarea id="chrono" inputmode="decimal" placeholder="2850 2862 2847 2855 2859"></textarea><div id="chronoOut" style="margin-top:8px"></div></div>`;
  v.querySelectorAll('[data-load]').forEach(b => b.onclick = () => { openLoad = b.dataset.load; render(); window.scrollTo(0, 0); });
  $('#addl').onclick = () => editLoad(null);
  $('#chrono').oninput = e => { const s = stats(parseVels(e.target.value)); $('#chronoOut').innerHTML = s ? statsHtml(s) : ''; };
}
const parseVels = t => String(t).split(/[\s,;]+/).map(num).filter(x => x && x > 100);
const statsHtml = s => `<div class="grid2"><div class="stat"><span>Shots</span><b class="num">${s.n}</b></div><div class="stat"><span>Average</span><b class="num">${f(s.avg, 0)} fps</b></div><div class="stat"><span>SD</span><b class="num">${f(s.sd, 1)}</b></div><div class="stat"><span>ES</span><b class="num">${f(s.es, 0)}</b></div></div>`;
function loadRow(l) {
  const best = bestTest(l);
  return `<div class="list-item" data-load="${l.id}"><div class="grow"><div class="t">${esc(l.name || 'Untitled load')} <span class="pill ${l.status === 'keeper' ? 'good' : ''}">${STATUS[l.status] || ''}</span></div>
    <div class="muted">${esc([l.bullet, l.powder].filter(Boolean).join(' · '))}</div>
    ${best ? `<div class="tiny">Best: ${f(best.charge, 1)} gr → ${f(best.moa, 2)} MOA${best.vs ? `, ${f(best.vs.avg, 0)} fps SD ${f(best.vs.sd, 1)}` : ''}</div>` : ''}</div><span class="muted">›</span></div>`;
}
function testMoa(t) { const d = t.distance || 100; return t.group != null ? t.group / (1.047198 * d / 100) : null; }
function bestTest(l) {
  let b = null;
  (l.tests || []).forEach(t => { const moa = testMoa(t); if (moa != null && (!b || moa < b.moa)) b = { ...t, moa, vs: stats(t.vels || []) }; });
  return b;
}
function renderLoad(v, l) {
  if (!l) { openLoad = null; return render(); }
  const tests = (l.tests || []).slice().sort((a, b) => (a.charge ?? 0) - (b.charge ?? 0));
  const best = bestTest(l);
  const bc = DATA && DATA.bullets ? DATA.bullets.find(b => bulletLabel(b) === l.bullet) : null;
  v.innerHTML = `
    <button class="btn small" id="back">‹ All loads</button>
    <h2>${esc(cartName(l.cartridge))}</h2>
    <div class="card">
      <div class="row" style="align-items:flex-start"><div class="grow"><div style="font-size:21px;font-weight:750">${esc(l.name || 'Untitled load')}</div><span class="pill ${l.status === 'keeper' ? 'good' : ''}">${STATUS[l.status]}</span></div><button class="btn small" id="edit" style="flex:0">Edit</button></div>
      <div style="margin-top:10px">
        ${[['Bullet', l.bullet + (bc && bc.g1 ? ` (G1 ${bc.g1}${bc.g7 ? `, G7 ${bc.g7}` : ''})` : '')], ['Powder', l.powder], ['Primer', l.primer], ['Brass', l.brass + (l.firings ? ` · ${l.firings}× fired` : '')],
          ['Manual range', l.start || l.max ? `${l.start || '?'} – ${l.max || '?'} gr` : ''], ['COAL', l.coal ? l.coal + '"' : ''], ['CBTO', l.cbto ? l.cbto + '"' : ''], ['Seating / crimp', l.crimp], ['Source', l.source]]
          .filter(x => x[1]).map(([k, val]) => `<div class="stat"><span class="muted">${k}</span><span style="text-align:right">${esc(val)}</span></div>`).join('')}
      </div>
      ${l.notes ? `<div class="how" style="white-space:pre-wrap">${esc(l.notes)}</div>` : ''}
    </div>
    ${l.max ? `<div class="tiny" style="margin:-4px 0 10px">Tests above your manual max (${esc(l.max)} gr) are flagged in red.</div>` : ''}

    <h2>Workup results</h2>
    <div class="card">
      ${tests.length ? `${chartSvg(tests)}<div style="overflow-x:auto"><table><thead><tr><th class="n">Charge</th><th class="n">Group</th><th class="n">MOA</th><th class="n">Avg fps</th><th class="n">SD</th><th class="n">ES</th></tr></thead><tbody>
        ${tests.map(t => { const s = stats(t.vels || []); const m = testMoa(t); const over = l.max && t.charge > num(l.max);
          return `<tr data-test="${t.id}" class="${best && best.id === t.id ? 'best' : ''}" style="cursor:pointer"><td class="n" style="${over ? 'color:var(--bad);font-weight:700' : ''}">${f(t.charge, 1)}</td><td class="n">${t.group != null ? f(t.group, 2) + '"' : '<span class="muted">tap</span>'}</td><td class="n">${f(m, 2)}</td><td class="n">${s ? f(s.avg, 0) : '–'}</td><td class="n">${s && s.n > 1 ? f(s.sd, 1) : '–'}</td><td class="n">${s && s.n > 1 ? f(s.es, 0) : '–'}</td></tr>`; }).join('')}
        </tbody></table></div>
        ${best ? `<div class="tiny" style="margin-top:8px">Green row = smallest group so far. Look for a spot where 2–3 charges in a row group well and velocity flattens out — that's your most forgiving load.</div>` : ''}` : `<div class="empty">No tests yet. Build a ladder or add one charge at a time.</div>`}
      <div class="tool"><button class="btn small" id="ladder">Build a ladder</button><button class="btn small primary" id="addt">+ Add test</button></div>
    </div>`;
  $('#back').onclick = () => { openLoad = null; render(); };
  $('#edit').onclick = () => editLoad(l);
  $('#addt').onclick = () => editTest(l, null);
  $('#ladder').onclick = () => ladder(l);
  v.querySelectorAll('[data-test]').forEach(tr => tr.onclick = () => editTest(l, l.tests.find(t => t.id === tr.dataset.test)));
}
function chartSvg(tests) {
  const pts = tests.filter(t => t.charge != null);
  if (pts.length < 2) return '';
  const W = 320, H = 150, P = 30;
  const xs = pts.map(t => t.charge), x0 = Math.min(...xs), x1 = Math.max(...xs);
  const X = c => P + (x1 === x0 ? 0.5 : (c - x0) / (x1 - x0)) * (W - 2 * P);
  const ms = pts.map(testMoa).filter(m => m != null); const mMax = Math.max(1, ...ms);
  const vs = pts.map(t => (stats(t.vels || []) || {}).avg).filter(Boolean); const v0 = Math.min(...vs), v1 = Math.max(...vs);
  const bw = Math.max(6, (W - 2 * P) / pts.length * 0.5);
  const bars = pts.map(t => { const m = testMoa(t); if (m == null) return ''; const h = m / mMax * (H - 2 * P); return `<rect x="${X(t.charge) - bw / 2}" y="${H - P - h}" width="${bw}" height="${h}" rx="2" fill="var(--accent)" opacity=".85"/>`; }).join('');
  const vp = pts.map(t => { const s = stats(t.vels || []); if (!s) return null; const y = v1 === v0 ? H / 2 : H - P - (s.avg - v0) / (v1 - v0) * (H - 2 * P); return [X(t.charge), y]; }).filter(Boolean);
  const line = vp.length > 1 ? `<polyline points="${vp.map(p => p.join(',')).join(' ')}" fill="none" stroke="var(--center)" stroke-width="2.5"/>${vp.map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="var(--center)"/>`).join('')}` : '';
  return `<svg class="chart" viewBox="0 0 ${W} ${H}"><line x1="${P}" y1="${H - P}" x2="${W - P}" y2="${H - P}" stroke="var(--line)"/>${bars}${line}
    <text x="${P}" y="${H - 10}" font-size="11" fill="var(--dim)">${f(x0, 1)} gr</text><text x="${W - P}" y="${H - 10}" font-size="11" fill="var(--dim)" text-anchor="end">${f(x1, 1)} gr</text>
    <text x="${P}" y="14" font-size="11" fill="var(--accent)">■ group MOA</text>${vs.length > 1 ? `<text x="${W - P}" y="14" font-size="11" fill="var(--center)" text-anchor="end">● velocity ${f(v0, 0)}–${f(v1, 0)}</text>` : ''}</svg>`;
}
function componentOptions(kind, cart) {
  if (!DATA || !DATA[kind]) return '';
  let items = DATA[kind];
  if (kind === 'bullets') items = items.filter(b => b.cartridge === cart).map(b => bulletLabel(b));
  else if (kind === 'powders') items = items.filter(p => !p.cartridges || p.cartridges.includes(cart)).sort((a, b) => (a.burnRank || 999) - (b.burnRank || 999)).map(p => `${p.maker} ${p.name}`);
  else if (kind === 'primers') { const c = DATA.cartridges && DATA.cartridges.find(x => x.id === cart); const sz = c && c.primerSize ? c.primerSize.toLowerCase() : '';
    items = items.filter(p => !sz || (p.size || '').toLowerCase().includes(sz.split(' ').slice(0, 2).join(' '))).map(p => primerLabel(p)); }
  else if (kind === 'cases') items = items.filter(x => x.cartridge === cart).map(x => `${x.maker}`);
  return [...new Set(items)].map(x => `<option value="${esc(x)}">`).join('');
}
function editLoad(l, prefill) {
  const isNew = !l;
  l = l ? { ...l } : { id: uid(), cartridge: '223', status: 'workup', tests: [], ...prefill };
  const body = () => `
    <div class="field"><label>Cartridge</label><div class="chips" id="lc">${CARTS.map(([c, n]) => `<button data-c="${c}" class="${l.cartridge === c ? 'on' : ''}">${n}</button>`).join('')}</div></div>
    <div class="field"><label>Load name</label><input id="l_name" value="${esc(l.name)}" placeholder="e.g. 77 TMK / Varget"></div>
    <div class="field"><label>Bullet</label><input id="l_bullet" list="dl_b" value="${esc(l.bullet)}" placeholder="Start typing…"><datalist id="dl_b">${componentOptions('bullets', l.cartridge)}</datalist></div>
    <div class="field"><label>Powder</label><input id="l_powder" list="dl_p" value="${esc(l.powder)}" placeholder="Start typing…"><datalist id="dl_p">${componentOptions('powders', l.cartridge)}</datalist></div>
    <div class="field"><label>Primer</label><input id="l_primer" list="dl_pr" value="${esc(l.primer)}"><datalist id="dl_pr">${componentOptions('primers', l.cartridge)}</datalist></div>
    <div class="grid2"><div class="field"><label>Brass</label><input id="l_brass" list="dl_c" value="${esc(l.brass)}"><datalist id="dl_c">${componentOptions('cases', l.cartridge)}</datalist></div>
      <div class="field"><label>Times fired</label><input id="l_firings" inputmode="numeric" value="${esc(l.firings)}"></div></div>
    <div class="grid2"><div class="field"><label>Manual start (gr)</label><input id="l_start" inputmode="decimal" value="${esc(l.start)}"></div>
      <div class="field"><label>Manual MAX (gr)</label><input id="l_max" inputmode="decimal" value="${esc(l.max)}"></div></div>
    <div class="field"><label>Source (manual, edition, page)</label><input id="l_source" value="${esc(l.source)}" placeholder="Hornady 11th ed. p. 312"></div>
    <div class="grid2"><div class="field"><label>COAL (in)</label><input id="l_coal" inputmode="decimal" value="${esc(l.coal)}"></div>
      <div class="field"><label>CBTO (in)</label><input id="l_cbto" inputmode="decimal" value="${esc(l.cbto)}"></div></div>
    <div class="field"><label>Seating depth / crimp</label><input id="l_crimp" value="${esc(l.crimp)}" placeholder="0.020 off lands / light taper crimp"></div>
    <div class="field"><label>Status</label><select id="l_status">${Object.entries(STATUS).map(([k, n]) => `<option value="${k}" ${l.status === k ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
    <div class="field"><label>Notes</label><textarea id="l_notes">${esc(l.notes)}</textarea></div>
    <button class="btn primary block" id="l_save">Save load</button>
    ${isNew ? '' : `<button class="btn block" id="l_dup" style="margin-top:10px">Duplicate</button><button class="btn danger block" id="l_del" style="margin-top:10px">Delete load</button>`}`;
  const grab = el => ['name', 'bullet', 'powder', 'primer', 'brass', 'firings', 'start', 'max', 'source', 'coal', 'cbto', 'crimp', 'status', 'notes'].forEach(k => { l[k] = $('#l_' + k, el).value.trim(); });
  const bind = el => {
    $('#lc', el).onclick = e => { const b = e.target.closest('button'); if (!b) return; grab(el); l.cartridge = b.dataset.c; $('.inner', el).lastElementChild; el.querySelector('.inner').innerHTML = el.querySelector('.bar').outerHTML + body(); $('#sx', el).onclick = closeSheet; bind(el); };
    $('#l_save', el).onclick = () => {
      grab(el);
      if (l.start && l.max && num(l.start) > num(l.max)) return toast('Start charge is higher than max — check the numbers');
      const i = S.loads.findIndex(x => x.id === l.id); if (i >= 0) S.loads[i] = l; else S.loads.push(l);
      save(); closeSheet(); openLoad = l.id; tab = 'loads'; syncNav(); render(); toast('Load saved');
    };
    const dup = $('#l_dup', el); if (dup) dup.onclick = () => { grab(el); const c = { ...l, id: uid(), name: (l.name || '') + ' (copy)', tests: [] }; S.loads.push(c); save(); closeSheet(); openLoad = c.id; render(); };
    const del = $('#l_del', el); if (del) del.onclick = () => { if (!confirm('Delete this load and all its test results?')) return; S.loads = S.loads.filter(x => x.id !== l.id); save(); closeSheet(); openLoad = null; render(); };
  };
  sheet(isNew ? 'New load' : 'Edit load', body(), bind);
}
function syncNav() { document.querySelectorAll('#nav button').forEach(x => x.classList.toggle('on', x.dataset.tab === tab)); }
function editTest(l, t) {
  const isNew = !t; t = t ? { ...t } : { id: uid(), date: new Date().toISOString().slice(0, 10), distance: 100, rifleId: S.activeRifle, vels: [] };
  sheet(isNew ? 'Add test' : `Test · ${f(t.charge, 1)} gr`, `
    <div class="grid2"><div class="field"><label>Charge (gr)</label><input id="t_charge" inputmode="decimal" value="${t.charge ?? ''}"></div>
      <div class="field"><label>Date</label><input id="t_date" type="date" value="${esc(t.date)}"></div></div>
    <div id="t_over"></div>
    <div class="grid2"><div class="field"><label>Group size c‑c (in)</label><input id="t_group" inputmode="decimal" value="${t.group ?? ''}"></div>
      <div class="field"><label>Distance (yd)</label><input id="t_dist" inputmode="decimal" value="${t.distance ?? 100}"></div></div>
    <div class="field"><label>Velocities (fps)</label><textarea id="t_vels" inputmode="decimal" placeholder="2850 2862 2847">${(t.vels || []).join(' ')}</textarea><div id="t_stats"></div></div>
    <div class="grid2"><div class="field"><label>Rifle</label><select id="t_rifle">${S.rifles.map(r => `<option value="${r.id}" ${r.id === t.rifleId ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Temp (°F)</label><input id="t_temp" inputmode="decimal" value="${esc(t.temp)}"></div></div>
    <div class="field"><label>Pressure signs / notes</label><textarea id="t_notes" placeholder="Flat primers? Heavy bolt lift? Ejector marks?">${esc(t.notes)}</textarea></div>
    <button class="btn primary block" id="t_save">Save test</button>
    ${isNew ? '' : `<button class="btn danger block" id="t_del" style="margin-top:10px">Delete test</button>`}`, el => {
    const upd = () => { const s = stats(parseVels($('#t_vels', el).value)); $('#t_stats', el).innerHTML = s ? statsHtml(s) : '';
      const c = num($('#t_charge', el).value); $('#t_over', el).innerHTML = l.max && c > num(l.max) ? `<div class="warn">This is <b>above the manual max</b> of ${esc(l.max)} gr you entered for this load.</div>` : ''; };
    $('#t_vels', el).oninput = upd; $('#t_charge', el).oninput = upd; upd();
    $('#t_save', el).onclick = () => {
      Object.assign(t, { charge: num($('#t_charge', el).value), date: $('#t_date', el).value, group: num($('#t_group', el).value), distance: num($('#t_dist', el).value) || 100,
        vels: parseVels($('#t_vels', el).value), rifleId: $('#t_rifle', el).value, temp: $('#t_temp', el).value, notes: $('#t_notes', el).value });
      l.tests = l.tests || []; const i = l.tests.findIndex(x => x.id === t.id); if (i >= 0) l.tests[i] = t; else l.tests.push(t);
      save(); closeSheet(); render();
    };
    const d = $('#t_del', el); if (d) d.onclick = () => { l.tests = l.tests.filter(x => x.id !== t.id); save(); closeSheet(); render(); };
  });
}
function ladder(l) {
  sheet('Build a ladder', `
    <div class="muted" style="margin-bottom:12px">Creates one row per charge so you can fill in groups and velocities at the range. Use the start and max from your manual.</div>
    <div class="grid2"><div class="field"><label>Start (gr)</label><input id="g_s" inputmode="decimal" value="${esc(l.start)}"></div><div class="field"><label>End (gr)</label><input id="g_e" inputmode="decimal" value="${esc(l.max)}"></div></div>
    <div class="field"><label>Step (gr)</label><select id="g_st">${[0.1, 0.2, 0.3, 0.4, 0.5, 1].map(s => `<option ${s === (l.cartridge === '9mm' ? 0.1 : (l.cartridge === '7prc' ? 0.5 : 0.3)) ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
    <div id="g_prev" class="tiny"></div>
    <button class="btn primary block" id="g_go" style="margin-top:12px">Create rows</button>`, el => {
    const steps = () => { const s = num($('#g_s', el).value), e = num($('#g_e', el).value), st = +$('#g_st', el).value; if (!s || !e || e < s) return []; const out = []; for (let c = s; c <= e + 1e-6 && out.length < 40; c += st) out.push(Math.round(c * 10) / 10); return out; };
    const prev = () => { const s = steps(); $('#g_prev', el).textContent = s.length ? `${s.length} charges: ${s.join(', ')}` : 'Enter start and end.'; };
    ['#g_s', '#g_e', '#g_st'].forEach(id => $(id, el).oninput = prev); prev();
    $('#g_go', el).onclick = () => {
      const s = steps(); if (!s.length) return toast('Enter a start and end');
      if (l.max && s[s.length - 1] > num(l.max)) { if (!confirm('The ladder goes above the manual max you entered. Continue?')) return; }
      l.tests = l.tests || []; s.forEach(c => l.tests.push({ id: uid(), charge: c, date: new Date().toISOString().slice(0, 10), distance: 100, rifleId: S.activeRifle, vels: [] }));
      save(); closeSheet(); render(); toast(`${s.length} rows added`);
    };
  });
}

// ---------- DATA ----------
function renderData(v) {
  if (DATA === null) { v.innerHTML = '<div class="empty">Loading…</div>'; return; }
  if (!DATA) { v.innerHTML = '<div class="empty">Reference data did not load. Open the app once with signal so it can save it.</div>'; return; }
  const c = (DATA.cartridges || []).find(x => x.id === dataCart);
  const q = dataQ.toLowerCase();
  const match = o => !q || JSON.stringify(o).toLowerCase().includes(q);
  let body = '';
  if (dataSec === 'specs' && c) {
    body = `<div class="card">${[['Bullet diameter', c.bulletDiameter && c.bulletDiameter + '"'], ['Max case length', c.maxCaseLength && c.maxCaseLength + '"'], ['Trim‑to length', c.trimLength && c.trimLength + '"'],
      ['Max COAL (SAAMI)', c.maxCOAL && c.maxCOAL + '"'], ['Max pressure', c.maxPressurePsi && Number(c.maxPressurePsi).toLocaleString() + ' psi'], ['Primer size', c.primerSize], ['Typical twist', c.typicalTwist]]
      .filter(x => x[1]).map(([k, val]) => `<div class="stat"><span class="muted">${k}</span><b class="num">${esc(val)}</b></div>`).join('')}
      ${c.notes ? `<div class="how">${esc(Array.isArray(c.notes) ? c.notes.join(' ') : c.notes)}</div>` : ''}
      ${c.commonPowders && c.commonPowders.length ? `<h2>Commonly used powders</h2><div class="chips">${c.commonPowders.map(p => `<span class="pill">${esc(p)}</span>`).join('')}</div>` : ''}
      ${c.sources && c.sources.length ? `<div class="tiny" style="margin-top:12px">Sources: ${c.sources.map(esc).join(' · ')}</div>` : ''}</div>`;
  } else if (dataSec === 'bullets') {
    const items = (DATA.bullets || []).filter(b => b.cartridge === dataCart && match(b)).sort((a, b) => a.weightGr - b.weightGr);
    body = `<div class="card">${items.map(b => `<div class="list-item"><div class="grow"><div class="t">${esc(bulletLabel(b))}</div>
      <div class="muted num">${b.weightGr} gr · ${esc(b.type || '')}${b.g1 ? ` · G1 ${b.g1}` : ''}${b.g7 ? ` · G7 ${b.g7}` : ''}${b.lengthIn ? ` · ${b.lengthIn}"` : ''}</div></div>
      ${b.use ? `<span class="pill">${esc(b.use)}</span>` : ''}<button class="btn small" data-use="${esc(bulletLabel(b))}">Use</button></div>`).join('') || '<div class="empty">No matches.</div>'}</div>`;
  } else if (dataSec === 'powders') {
    const items = (DATA.powders || []).filter(p => (!p.cartridges || p.cartridges.includes(dataCart)) && match(p)).sort((a, b) => (a.burnRank || 999) - (b.burnRank || 999));
    body = `<div class="tiny" style="margin-bottom:6px">Sorted fastest → slowest burning.</div><div class="card">${items.map(p => `<div class="list-item"><div class="grow"><div class="t">${esc(p.maker)} ${esc(p.name)}</div><div class="muted">${esc([p.type, p.notes].filter(Boolean).join(' · '))}</div></div>${p.burnRank ? `<span class="pill num">#${p.burnRank}</span>` : ''}</div>`).join('') || '<div class="empty">No matches.</div>'}</div>`;
  } else if (dataSec === 'primers') {
    const sz = c && c.primerSize ? c.primerSize.toLowerCase() : '';
    const items = (DATA.primers || []).filter(match).sort((a, b) => ((b.size || '').toLowerCase() === sz) - ((a.size || '').toLowerCase() === sz));
    body = `<div class="tiny" style="margin-bottom:6px">${c ? `${esc(c.name)} takes <b>${esc(c.primerSize)}</b> primers — shown first.` : ''}</div><div class="card">${items.map(p => `<div class="list-item"><div class="grow"><div class="t">${esc(primerLabel(p))}</div><div class="muted">${esc([p.size, p.name !== p.model ? p.name : '', p.notes].filter(Boolean).join(' · '))}</div></div>${(p.size || '').toLowerCase() === sz ? '<span class="pill good">fits</span>' : ''}</div>`).join('')}</div>`;
  } else if (dataSec === 'cases') {
    const items = (DATA.cases || []).filter(x => x.cartridge === dataCart && match(x));
    body = `<div class="card">${items.map(x => `<div class="list-item"><div class="grow"><div class="t">${esc(x.maker)}</div><div class="muted">${esc(x.notes || '')}${x.approxCapacityGrH2O ? ` · ~${x.approxCapacityGrH2O} gr H₂O` : ''}</div></div></div>`).join('') || '<div class="empty">No matches.</div>'}</div>`;
  }
  v.innerHTML = `
    <div class="chips" id="dc">${CARTS.map(([id, n]) => `<button data-c="${id}" class="${dataCart === id ? 'on' : ''}">${n}</button>`).join('')}</div>
    <div class="seg" id="ds" style="margin:12px 0">${[['specs', 'Specs'], ['bullets', 'Bullets'], ['powders', 'Powder'], ['primers', 'Primers'], ['cases', 'Brass']].map(([k, n]) => `<button data-s="${k}" class="${dataSec === k ? 'on' : ''}">${n}</button>`).join('')}</div>
    ${dataSec !== 'specs' ? `<input id="dq" placeholder="Search…" value="${esc(dataQ)}" style="margin-bottom:10px">` : ''}
    <div id="dbody">${body}</div>
    <div class="tiny">No powder charges are stored here on purpose. Charge weights come from your manuals.</div>`;
  $('#dc').onclick = e => { const b = e.target.closest('button'); if (!b) return; dataCart = b.dataset.c; render(); };
  $('#ds').onclick = e => { const b = e.target.closest('button'); if (!b) return; dataSec = b.dataset.s; render(); };
  const dq = $('#dq'); if (dq) dq.oninput = e => { dataQ = e.target.value; const pos = e.target.selectionStart; render(); const n = $('#dq'); n.focus(); n.setSelectionRange(pos, pos); };
  v.querySelectorAll('[data-use]').forEach(b => b.onclick = () => editLoad(null, { cartridge: dataCart, bullet: b.dataset.use }));
}

// ---------- MORE ----------
function renderMore(v) {
  v.innerHTML = `
  <h2>How to sight in</h2>
  <div class="card">
    <ol style="margin:0;padding-left:20px;line-height:1.55">
      <li><b>Bore sight first</b> if the scope is new. Pull the bolt, rest the rifle, look through the barrel at a target at 25 yd, and move the crosshair onto it.</li>
      <li><b>Start at 25 yards</b> if you're not on paper at 100. Set the distance here to 25 — the app handles the math.</li>
      <li><b>Solid rest.</b> Bags front and rear. Same cheek weld and grip each shot.</li>
      <li><b>Shoot 3 shots</b> at the center. Don't chase single shots — move the group center.</li>
      <li><b>Tap the holes</b> (or type how far off the group is). Dial exactly what it says.</li>
      <li><b>Let the barrel cool</b> between groups, especially the 7 PRC.</li>
      <li><b>Repeat</b> until it says ZEROED, then confirm with one more group.</li>
      <li><b>Reset the turret caps</b> to 0 (loosen the screws, spin the cap to 0 without moving the turret, tighten). Set zero stop if your scope has one.</li>
    </ol>
  </div>
  <h2>Click math</h2>
  <div class="card">
    <div class="stat"><span>1 MOA at 100 yd</span><b class="num">1.047"</b></div>
    <div class="stat"><span>1/4 MOA click at 100 yd</span><b class="num">0.26"</b></div>
    <div class="stat"><span>1 MIL at 100 yd</span><b class="num">3.6"</b></div>
    <div class="stat"><span>0.1 MIL click at 100 yd</span><b class="num">0.36"</b></div>
    <div class="stat"><span>At 25 yd, every click moves</span><b>¼ as much</b></div>
  </div>
  <h2>Settings</h2>
  <div class="card">
    <div class="field"><label>Theme</label><div class="seg" id="th"><button data-t="dark" class="${S.settings.theme === 'dark' ? 'on' : ''}">Dark</button><button data-t="light" class="${S.settings.theme === 'light' ? 'on' : ''}">Bright sun</button></div></div>
    <label>Backup</label>
    <div class="tiny" style="margin-bottom:8px">Everything is saved only on this phone. Export a backup now and then — clearing Chrome's site data will erase it.</div>
    <div class="tool" style="margin:0"><button class="btn small" id="exp">Export backup</button><button class="btn small" id="imp">Import backup</button></div>
    <input type="file" id="impf" accept="application/json,.json" style="display:none">
    <div class="tiny" style="margin-top:10px">${S.rifles.length} rifles · ${S.loads.length} loads · ${S.loads.reduce((a, l) => a + (l.tests || []).length, 0)} tests · ${S.groups.length} groups</div>
  </div>
  <h2>Install on your phone</h2>
  <div class="card muted">Open this page in Chrome, tap ⋮ → <b>Add to Home screen</b> (or <b>Install app</b>). Open it once with signal; after that it works with no signal at all.</div>`;
  $('#th').onclick = e => { const b = e.target.closest('button'); if (!b) return; S.settings.theme = b.dataset.t; save(); applyTheme(); render(); };
  $('#exp').onclick = () => {
    const blob = new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `zero-in-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  };
  $('#imp').onclick = () => $('#impf').click();
  $('#impf').onchange = e => {
    const file = e.target.files[0]; if (!file) return;
    file.text().then(t => { const d = JSON.parse(t); if (!d.rifles) throw 0; if (!confirm('Replace everything on this phone with this backup?')) return; S = d; save(); applyTheme(); render(); toast('Backup restored'); }).catch(() => toast('That file is not a Zero In backup'));
  };
}

// ---------- boot ----------
render();
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
