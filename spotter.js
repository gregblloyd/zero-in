'use strict';
/* Spotter: one-screen firing solution. Uses globals from app.js (S, $, esc, f, num, rifle, save, toast, sheet, closeSheet, uid, DATA). */

const DEFAULT_BAL = {
  bullet: 'Hornady 7mm 175 gr ELD-X', model: 'G7', bc: 0.347, mv: 2880, sh: 1.75, twist: 8, twistDir: 'right',
  weight: 175, length: '', diam: 0.284, revMoa: '', windMode: 'hold', zeroTemp: '', zeroAlt: '', mvEstimated: true,
};
function balOf(r) {
  if (!r.bal) {
    const isPrc = /prc/i.test(r.caliber || '') || /7\s*mm/i.test(r.caliber || '');
    r.bal = isPrc ? { ...DEFAULT_BAL } : { ...DEFAULT_BAL, bullet: '', bc: 0.3, mv: 2700, weight: '', diam: '', mvEstimated: true };
    save();
  }
  return r.bal;
}
function cond() {
  S.cond = S.cond || { range: 400, windMph: 5, windClock: 3, angle: 0, tempF: 50, altFt: 5000, humidity: 40, pressureInHg: '', src: '' };
  return S.cond;
}
const CLOCK_NAMES = { 12: 'head‑on', 6: 'tail', 3: 'from the right', 9: 'from the left', 1: 'from the right', 2: 'from the right', 4: 'from the right', 5: 'from the right', 7: 'from the left', 8: 'from the left', 10: 'from the left', 11: 'from the left' };
function windValue(c) { const v = Math.abs(Math.sin(c * Math.PI / 6)); return v > 0.95 ? 'full value' : v > 0.6 ? '¾ value' : v > 0.3 ? 'half value' : 'no value'; }
function fmtClicks(n) { return `${n} click${n === 1 ? '' : 's'}`; }
function niceMoa(m, click) { const q = Math.round(m / click) * click; return q.toFixed(2).replace(/0$/, '').replace(/\.0$/, ''); }

function solution() {
  const r = rifle(), b = balOf(r), c = cond();
  const atm = { tempF: +c.tempF, humidity: +c.humidity,
    pressureInHg: num(c.pressureInHg) || BAL.pressureAtAlt(+c.altFt || 0) };
  const zeroAtm = { tempF: num(b.zeroTemp) ?? 59, humidity: 50, pressureInHg: BAL.pressureAtAlt(num(b.zeroAlt) || 0) };
  const zeroYd = r.distUnit === 'm' ? r.zeroDist * 1.0936 : r.zeroDist;
  const p = { bc: +b.bc, model: b.model, mv: +b.mv, sightHeight: +b.sh, zeroYd, zeroOffsetIn: r.zeroOffset || 0,
    twistIn: +b.twist, twistDir: b.twistDir, weightGr: +b.weight, diameterIn: +b.diam, lengthIn: num(b.length),
    rangeYd: +c.range, lookAngle: +c.angle, atm, zeroAtm, windMph: +c.windMph, windFromClock: +c.windClock };
  if (!(p.bc > 0 && p.mv > 500 && p.rangeYd > 0)) return null;
  const s = BAL.solve(p);
  const at = s.at(p.rangeYd);
  // Wind per 5 mph (for brackets): full-value 5 mph minus the spin-drift part, one extra trajectory instead of two.
  const w5 = BAL.solve({ ...p, windMph: 5, windFromClock: 3 }).at(p.rangeYd);
  const spinMoa = Math.atan(w5.spinIn / 12 / (p.rangeYd * 3)) * 180 / Math.PI * 60;
  return { p, s, at, per5: Math.abs(w5.windMoa + spinMoa), r, b, c, atm };
}

function renderSpotter(v) {
  const r = rifle(), b = balOf(r), c = cond();
  v.innerHTML = `
  <div class="spot-head">
    <select id="sp_rifle" class="chip-select">${S.rifles.map(x => `<option value="${x.id}" ${x.id === r.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
    <button class="btn small" id="sp_load">${esc(b.bullet ? b.bullet.replace(/^Hornady /, '').replace(/\s*\(.*\)/, '') : 'Set load')} · ${esc(b.mv)} fps${b.trued ? ' ✓' : ''}</button>
  </div>
  ${b.mvEstimated ? `<div class="warn" style="margin:0 0 10px">Muzzle velocity is an <b>estimate</b>. Chrono your rifle and enter it in <a href="#" id="sp_fix" style="color:inherit">load data</a>, or shoot far and <a href="#" id="sp_fix2" style="color:inherit">true it</a> — it's the #1 thing that makes long shots hit.</div>` : ''}

  <div id="sol"></div>
  <div id="spq" class="quick spq" hidden></div>

  <div class="card in-card">
    <div class="in-row">
      <div class="in-label">RANGE</div>
      <div class="stepper">
        <button data-step="range" data-d="-25">−</button>
        <input id="sp_range" class="num big" inputmode="numeric" value="${esc(c.range)}"><span class="unit-s">yd</span>
        <button data-step="range" data-d="25">+</button>
      </div>
    </div>
    <div class="in-row">
      <div class="in-label">WIND</div>
      <div class="stepper">
        <button data-step="windMph" data-d="-1">−</button>
        <input id="sp_wind" class="num big" inputmode="numeric" value="${esc(c.windMph)}"><span class="unit-s">mph</span>
        <button data-step="windMph" data-d="1">+</button>
      </div>
    </div>
    <div class="clock-wrap">${clockSvg(c.windClock)}<div class="clock-note" id="clocknote">${clockNote(c.windClock)}</div></div>
    <div class="in-row">
      <div class="in-label">ANGLE</div>
      <div class="stepper">
        <button data-step="angle" data-d="-1">−</button>
        <input id="sp_angle" class="num big" inputmode="decimal" value="${esc(c.angle)}"><span class="unit-s">°</span>
        <button data-step="angle" data-d="1">+</button>
      </div>
    </div>
    <button class="btn small block" id="sp_measure" style="margin-top:4px">📐 Measure angle with phone</button>
  </div>

  <div class="card in-card">
    <div class="row" style="align-items:flex-end">
      <div><label>Temp °F</label><input id="sp_temp" class="num" inputmode="decimal" value="${esc(c.tempF)}"></div>
      <div><label>Altitude ft</label><input id="sp_alt" class="num" inputmode="numeric" value="${esc(c.altFt)}"></div>
      <div style="flex:.8"><label>Humid %</label><input id="sp_hum" class="num" inputmode="numeric" value="${esc(c.humidity)}"></div>
    </div>
    <button class="btn small block" id="sp_loc" style="margin-top:10px">📍 Use my location${navigator.onLine ? ' + weather' : ' (altitude)'}</button>
    <div class="tiny" id="sp_src" style="margin-top:6px">${esc(c.src || 'Enter conditions, or tap to fill them from GPS and the weather.')}</div>
  </div>

  <button class="btn block" id="sp_card">📋 Dope card for these conditions</button>
  <button class="btn block" id="sp_true" style="margin-top:10px">🎯 True it — hits high or low far out?</button>
  <div class="tiny" style="margin:10px 2px 0">Wind is the hardest part. Read it at the target, not where you sit. Bracket it: the ± line tells you how much each 5 mph changes your hold.</div>
  `;
  $('#sp_rifle').onchange = e => { S.activeRifle = e.target.value; save(); render(); };
  $('#sp_load').onclick = () => editBal(rifle());
  const fx = $('#sp_fix'); if (fx) fx.onclick = e => { e.preventDefault(); editBal(rifle()); };
  const fx2 = $('#sp_fix2'); if (fx2) fx2.onclick = e => { e.preventDefault(); trueIt(); };
  const bind = (id, key) => { $(id).oninput = e => { c[key] = e.target.value; saveSoon(); queueSol(); }; };
  bind('#sp_range', 'range'); bind('#sp_wind', 'windMph'); bind('#sp_angle', 'angle'); bind('#sp_temp', 'tempF'); bind('#sp_alt', 'altFt'); bind('#sp_hum', 'humidity');
  // − / + buttons: fire on touch‑down (no tap delay), hold to repeat and speed up.
  const stepOnce = btn => {
    const k = btn.dataset.step, d = +btn.dataset.d;
    let val = (num(c[k]) || 0) + d;
    if (k === 'range') val = Math.max(25, Math.round(val / 25) * 25);
    if (k === 'windMph') val = Math.max(0, val);
    if (k === 'angle') val = Math.max(-60, Math.min(60, val));
    c[k] = val; saveSoon();
    $(({ range: '#sp_range', windMph: '#sp_wind', angle: '#sp_angle' })[k]).value = val; queueSol();
  };
  v.querySelectorAll('[data-step]').forEach(btn => {
    let timer = 0, n = 0;
    const stop = () => { clearTimeout(timer); timer = 0; btn.classList.remove('held'); };
    const tick = () => { stepOnce(btn); n++; timer = setTimeout(tick, n < 4 ? 160 : n < 12 ? 90 : 45); };
    btn.addEventListener('pointerdown', e => { e.preventDefault(); stop(); n = 0; btn.classList.add('held');
      try { btn.setPointerCapture(e.pointerId); } catch (x) {}
      stepOnce(btn); timer = setTimeout(tick, 380); });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev => btn.addEventListener(ev, stop));
    btn.addEventListener('contextmenu', e => e.preventDefault());
    btn.addEventListener('click', e => { if (e.detail === 0) stepOnce(btn); }); // keyboard / accessibility only
  });
  bindClock();
  $('#sp_measure').onclick = measureAngle;
  $('#sp_loc').onclick = useLocation;
  $('#sp_card').onclick = dopeCard;
  $('#sp_true').onclick = trueIt;
  updateSol();
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(([e]) => { const q = $('#spq'); if (q) q.hidden = e.isIntersecting; }, { threshold: 0.35 });
    io.observe($('#sol'));
  }
}
function clockNote(c) { return `<b>${c} o'clock</b> · ${CLOCK_NAMES[c]} · ${windValue(c)}`; }
function clockSvg(sel) {
  let s = '<svg viewBox="-110 -110 220 220" class="clock" id="clock">';
  s += '<circle r="100" class="ck-ring"/><circle r="62" class="ck-inner"/>';
  for (let h = 1; h <= 12; h++) {
    const a = h * Math.PI / 6, x = 82 * Math.sin(a), y = -82 * Math.cos(a);
    s += `<g class="ck-h ${h === sel ? 'on' : ''}" data-h="${h}"><circle cx="${x}" cy="${y}" r="17"/><text x="${x}" y="${y + 6}" text-anchor="middle">${h}</text></g>`;
  }
  // wind arrow from selected clock toward the shooter
  const a = sel * Math.PI / 6, sx = 58 * Math.sin(a), sy = -58 * Math.cos(a), ex = 16 * Math.sin(a), ey = -16 * Math.cos(a);
  s += `<line x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}" class="ck-arrow" marker-end="url(#ah)"/>`;
  s += '<defs><marker id="ah" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10z" fill="var(--center)"/></marker></defs>';
  // shooter + target direction
  s += '<path d="M0 -40 L7 -26 L-7 -26 Z" class="ck-target"/><text y="-46" text-anchor="middle" class="ck-tl">TARGET</text><circle r="6" class="ck-me"/>';
  return s + '</svg>';
}
function bindClock() {
  $('#clock').onclick = e => {
    const g = e.target.closest('[data-h]'); if (!g) return;
    cond().windClock = +g.dataset.h; save();
    $('#clock').outerHTML = clockSvg(cond().windClock); $('#clocknote').innerHTML = clockNote(cond().windClock); bindClock(); updateSol();
  };
}

let solQueued = false, saveTimer = 0;
function queueSol() { if (solQueued) return; solQueued = true; requestAnimationFrame(() => { solQueued = false; updateSol(); }); }
function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(save, 400); }
function updateSol() {
  const el = $('#sol'); if (!el) return;
  let sol; try { sol = solution(); } catch (e) { sol = null; }
  if (!sol || !sol.at) { el.innerHTML = '<div class="card empty">Enter a range.</div>'; return; }
  const { at, r, b, c, per5 } = sol;
  const click = r.unit === 'MIL' ? r.click : r.click; const u = r.unit === 'MIL' ? 'MIL' : 'MOA';
  const toU = moa => r.unit === 'MIL' ? moa / 3.43775 : moa;
  const elev = toU(at.elevMoa), wind = toU(at.windMoa);
  const eClicks = Math.round(Math.abs(elev) / click), wClicks = Math.round(Math.abs(wind) / click);
  const eDir = elev >= 0 ? 'UP' : 'DOWN', wDir = wind >= 0 ? 'RIGHT' : 'LEFT';
  const eTurn = turnDir(r, 'elev', eDir), wTurn = turnDir(r, 'wind', wDir);
  const rev = num(b.revMoa);
  const revTxt = rev && eClicks * click > rev ? ` · ${Math.floor(eClicks * click / rev)} turn${Math.floor(eClicks * click / rev) > 1 ? 's' : ''} + ${Math.round((eClicks * click % rev) / click)}` : '';
  const holdWind = b.windMode !== 'dial';
  const noWind = !(+c.windMph > 0);
  const spinU = toU(-Math.atan(at.spinIn / 12 / (c.range * 3)) * 180 / Math.PI * 60); // + = correct right
  const spinDir = at.spinIn >= 0 ? 'right' : 'left';
  const e5 = toU(per5);
  const energy = at.energy;
  const call = `${eClicks ? `Dial ${niceMoa(Math.abs(elev), click)} ${eDir.toLowerCase()}` : 'Hold center'}. ${wClicks ? `${holdWind ? 'Hold' : 'Dial'} ${niceMoa(Math.abs(wind), click)} ${wDir.toLowerCase()}${noWind ? ' for spin drift' : ''}` : 'No wind hold'}. Send it.`;
  const q = $('#spq');
  if (q) q.innerHTML = `<span><small>DIAL ${eDir}</small><b>${niceMoa(Math.abs(elev), click)} ${u}</b><small>turn ${turnWord(eTurn).toLowerCase()} ${eClicks} clicks</small></span><span><small>${holdWind ? 'HOLD' : 'DIAL'} ${wDir}</small><b>${niceMoa(Math.abs(wind), click)} ${u}</b><small>${wClicks ? `turn ${turnWord(wTurn).toLowerCase()} ${wClicks} click${wClicks === 1 ? '' : 's'}` : 'no clicks'}${noWind ? ' · spin' : ''}</small></span>`;
  el.innerHTML = `
  <div class="sol">
    <div class="sol-call">“${call}”</div>
    <div class="sol-grid">
      <div class="sol-box">
        <div class="k">ELEVATION · DIAL</div>
        <div class="big num">${eDir === 'UP' ? '▲' : '▼'} ${niceMoa(Math.abs(elev), click)}</div>
        <div class="u">${u} ${eDir}</div><div class="exact">exact ${f(Math.abs(elev), 2)}</div>
        <div class="turn2">${rotSvg(eTurn)} turn ${turnWord(eTurn).toLowerCase()} <b>${eClicks}</b> clicks${revTxt}</div>
      </div>
      <div class="sol-box">
        <div class="k">WIND · ${holdWind ? 'HOLD' : 'DIAL'}</div>
        <div class="big num">${wDir === 'RIGHT' ? '▶' : '◀'} ${niceMoa(Math.abs(wind), click)}</div>
        <div class="u">${u} ${wDir}</div><div class="exact">exact ${f(Math.abs(wind), 2)}</div>
        ${holdWind && wClicks ? '<div class="wnote" style="margin-top:8px;text-align:center">or to dial it:</div>' : ''}<div class="turn2${holdWind && wClicks ? ' tight' : ''}">${wClicks ? `${rotSvg(wTurn)} turn ${turnWord(wTurn).toLowerCase()} <b>${wClicks}</b> click${wClicks === 1 ? '' : 's'}` : 'no clicks'}</div>
        <div class="wnote">${noWind ? `all spin drift — the bullet's spin curves it ${spinDir} ${f(Math.abs(at.spinIn), 1)}"` : `±${f(e5, 2)} ${u} per 5 mph${Math.abs(spinU) >= click / 2 ? ` · spin drift already counted` : ''}`}</div>
      </div>
    </div>
    <div class="sol-stats">
      <span><b class="num">${f(Math.abs(at.dropIn), 1)}"</b> drop</span>
      <span><b class="num">${f(Math.abs(at.windIn), 1)}"</b> drift</span>
      <span><b class="num">${f(at.vel, 0)}</b> fps</span>
      <span><b class="num">${energy ? Math.round(energy).toLocaleString() : '–'}</b> ft‑lb</span>
      <span><b class="num">${f(at.tof, 2)}</b> s</span>
    </div>
    ${energy && energy < 1500 ? `<div class="tiny sol-warn">${energy < 1000 ? 'Under 1,000 ft‑lb — below the common deer guideline.' : 'Under 1,500 ft‑lb — below the common elk guideline.'}</div>` : ''}
    ${at.mach < 1.15 ? `<div class="tiny sol-warn">Bullet is near the speed of sound here — accuracy and drop get less predictable.</div>` : ''}
  </div>`;
}

function editBal(r) {
  const b = { ...balOf(r) };
  const bullets = (DATA && DATA.bullets) ? DATA.bullets.filter(x => x.g1 || x.g7) : [];
  sheet('Load data · ' + r.name, `
    <div class="field"><label>Pick a bullet (fills BC, weight, length)</label>
      <select id="b_pick"><option value="">— choose —</option>${bullets.map((x, i) => `<option value="${i}">${esc(bulletLabel(x))}</option>`).join('')}</select></div>
    <div class="field"><label>Bullet</label><input id="b_bullet" value="${esc(b.bullet)}"></div>
    <div class="grid2">
      <div class="field"><label>BC</label><input id="b_bc" inputmode="decimal" value="${esc(b.bc)}"></div>
      <div class="field"><label>Drag model</label><select id="b_model"><option ${b.model === 'G7' ? 'selected' : ''}>G7</option><option ${b.model === 'G1' ? 'selected' : ''}>G1</option></select></div>
    </div>
    <div class="tiny" style="margin:-6px 0 10px">Use G7 for long boat‑tail bullets when the maker gives it — it's more accurate at distance.</div>
    <div class="grid2">
      <div class="field"><label>Muzzle velocity (fps)</label><input id="b_mv" inputmode="numeric" value="${esc(b.mv)}"></div>
      <div class="field"><label>Measured?</label><select id="b_mve"><option value="0" ${!b.mvEstimated ? 'selected' : ''}>Yes, chronographed</option><option value="1" ${b.mvEstimated ? 'selected' : ''}>No, estimate</option></select></div>
    </div>
    <div class="grid2">
      <div class="field"><label>Sight height (in)</label><input id="b_sh" inputmode="decimal" value="${esc(b.sh)}"></div>
      <div class="field"><label>Twist (1 in __ in)</label><input id="b_twist" inputmode="decimal" value="${esc(b.twist)}"></div>
    </div>
    <div class="tiny" style="margin:-6px 0 10px">Sight height = center of the barrel to center of the scope. Measure from the bolt (center) to the scope tube center.</div>
    <div class="grid2">
      <div class="field"><label>Bullet weight (gr)</label><input id="b_weight" inputmode="decimal" value="${esc(b.weight)}"></div>
      <div class="field"><label>Bullet length (in)</label><input id="b_length" inputmode="decimal" value="${esc(b.length)}" placeholder="optional"></div>
    </div>
    <div class="grid2">
      <div class="field"><label>Diameter (in)</label><input id="b_diam" inputmode="decimal" value="${esc(b.diam)}"></div>
      <div class="field"><label>Twist direction</label><select id="b_tdir"><option value="right" ${b.twistDir !== 'left' ? 'selected' : ''}>Right (most)</option><option value="left" ${b.twistDir === 'left' ? 'selected' : ''}>Left</option></select></div>
    </div>
    <div class="grid2">
      <div class="field"><label>Wind: hold or dial?</label><select id="b_wm"><option value="hold" ${b.windMode !== 'dial' ? 'selected' : ''}>Hold (reticle)</option><option value="dial" ${b.windMode === 'dial' ? 'selected' : ''}>Dial</option></select></div>
      <div class="field"><label>${r.unit} per turret turn</label><input id="b_rev" inputmode="decimal" value="${esc(b.revMoa)}" placeholder="e.g. 15"></div>
    </div>
    <details class="field"><summary>Where you zeroed (optional)</summary>
      <div class="grid2"><div class="field"><label>Zero temp °F</label><input id="b_zt" inputmode="decimal" value="${esc(b.zeroTemp)}" placeholder="59"></div>
      <div class="field"><label>Zero altitude ft</label><input id="b_za" inputmode="numeric" value="${esc(b.zeroAlt)}" placeholder="0"></div></div>
    </details>
    <button class="btn primary block" id="b_save">Save load data</button>`, el => {
    $('#b_pick', el).onchange = e => { const x = bullets[+e.target.value]; if (!x) return;
      $('#b_bullet', el).value = bulletLabel(x); $('#b_bc', el).value = x.g7 || x.g1; $('#b_model', el).value = x.g7 ? 'G7' : 'G1';
      $('#b_weight', el).value = x.weightGr; $('#b_length', el).value = x.lengthIn || '';
      const dia = { '9mm': 0.355, '223': 0.224, '7prc': 0.284 }[x.cartridge]; if (dia) $('#b_diam', el).value = dia; };
    $('#b_save', el).onclick = () => {
      const g = id => $(id, el).value.trim();
      Object.assign(b, { bullet: g('#b_bullet'), bc: num(g('#b_bc')), model: g('#b_model'), mv: num(g('#b_mv')), mvEstimated: g('#b_mve') === '1',
        sh: num(g('#b_sh')), twist: num(g('#b_twist')), weight: num(g('#b_weight')), length: g('#b_length'), diam: num(g('#b_diam')),
        twistDir: g('#b_tdir'), windMode: g('#b_wm'), revMoa: g('#b_rev'), zeroTemp: g('#b_zt'), zeroAlt: g('#b_za') });
      if (!(b.bc > 0 && b.mv > 500 && b.sh > 0)) return toast('Need BC, velocity, and sight height');
      r.bal = b; save(); closeSheet(); render(); toast('Load data saved');
    };
  });
}

function measureAngle() {
  const start = () => {
    let last = null, lock = false;
    sheet('Measure angle', `
      <div class="muted" style="margin-bottom:12px">Lay the phone flat on top of the scope (screen up), with the top of the phone pointing at the target. Hold steady, then tap Lock.</div>
      <div class="angle-read num" id="ang_val">–</div>
      <div class="tiny" style="text-align:center;margin-bottom:14px" id="ang_hint">Waiting for the motion sensor…</div>
      <button class="btn primary block" id="ang_lock">Lock angle</button>`, el => {
      const h = e => { if (lock || e.beta == null) return; last = e.beta; // pitch: + when top edge raised
        el.querySelector('#ang_val').textContent = `${last > 0 ? '▲' : last < 0 ? '▼' : ''} ${Math.abs(last).toFixed(1)}°`;
        el.querySelector('#ang_hint').textContent = last >= 0 ? 'Uphill' : 'Downhill'; };
      window.addEventListener('deviceorientation', h);
      const stop = () => window.removeEventListener('deviceorientation', h);
      el.querySelector('#sx').addEventListener('click', stop);
      el.querySelector('#ang_lock').onclick = () => {
        stop(); lock = true;
        if (last == null) { closeSheet(); return toast('No motion sensor reading — type the angle instead'); }
        cond().angle = Math.round(last); save(); closeSheet(); render(); toast(`Angle set to ${Math.round(last)}°`);
      };
    });
  };
  start();
  try { if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function')
    DeviceOrientationEvent.requestPermission().then(st => { if (st === 'denied') toast('Motion access denied — type the angle instead'); }).catch(() => {}); } catch (e) {}
}

function useLocation() {
  if (!navigator.geolocation) return toast('No GPS on this device');
  const c = cond(); const btn = $('#sp_loc'); btn.disabled = true; btn.textContent = 'Getting location…';
  navigator.geolocation.getCurrentPosition(async pos => {
    const { latitude, longitude, altitude } = pos.coords;
    let src = [];
    if (altitude != null) { c.altFt = Math.round(altitude * 3.28084); src.push(`GPS altitude ${c.altFt.toLocaleString()} ft`); }
    if (navigator.onLine) {
      try {
        const u = `https://api.open-meteo.com/v1/forecast?latitude=${latitude.toFixed(3)}&longitude=${longitude.toFixed(3)}&current=temperature_2m,relative_humidity_2m,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m&temperature_unit=fahrenheit&wind_speed_unit=mph`;
        const d = await (await fetch(u)).json();
        const cur = d.current;
        c.tempF = Math.round(cur.temperature_2m); c.humidity = Math.round(cur.relative_humidity_2m);
        c.pressureInHg = ''; // altitude-based pressure keeps it simple; weather station pressure below if no GPS altitude
        if (altitude == null && d.elevation != null) { c.altFt = Math.round(d.elevation * 3.28084); src.push(`altitude ${c.altFt.toLocaleString()} ft`); }
        const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
        src.push(`${c.tempF}°F, ${c.humidity}% humidity`, `forecast wind ${Math.round(cur.wind_speed_10m)} mph from ${dirs[Math.round(cur.wind_direction_10m / 45) % 8]}, gusts ${Math.round(cur.wind_gusts_10m)}`);
      } catch (e) { src.push('weather unavailable — enter temp'); }
    } else src.push('offline — enter temp');
    c.src = 'From ' + src.join(' · ') + ' · ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    save(); render(); toast('Conditions updated');
  }, () => { btn.disabled = false; btn.textContent = '📍 Use my location'; toast('Location not available'); }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
}

function dopeCard() {
  const base = solution(); if (!base) return toast('Set load data first');
  const r = base.r, u = r.unit === 'MIL' ? 'MIL' : 'MOA', toU = m => r.unit === 'MIL' ? m / 3.43775 : m;
  const s = BAL.solve(base.p, [1000]);
  const w10 = BAL.solve({ ...base.p, windMph: 10, windFromClock: 3 }, [1000]);
  const w0 = BAL.solve({ ...base.p, windMph: 0 }, [1000]);
  const rows = []; for (let yd = 100; yd <= 1000; yd += 50) {
    const a = s.at(yd); if (!a) break;
    const ww = Math.abs(toU(w10.at(yd).windMoa - w0.at(yd).windMoa));
    rows.push(`<tr><td class="n"><b>${yd}</b></td><td class="n">${f(toU(a.elevMoa), 2)}</td><td class="n">${Math.round(Math.abs(toU(a.elevMoa)) / r.click)}</td><td class="n">${f(ww, 2)}</td><td class="n">${f(a.vel, 0)}</td><td class="n">${a.energy ? Math.round(a.energy) : '–'}</td></tr>`);
  }
  const c = base.c;
  sheet('Dope card', `
    <div class="tiny" style="margin-bottom:8px">${esc(r.name)} · ${esc(base.b.bullet)} · ${base.b.mv} fps · ${c.tempF}°F · ${Number(c.altFt).toLocaleString()} ft · angle ${c.angle}°. Elevation is UP from your ${r.zeroDist} ${r.distUnit} zero. Wind = full‑value 10 mph.</div>
    <div style="overflow-x:auto"><table><thead><tr><th class="n">Yd</th><th class="n">Up ${u}</th><th class="n">Clicks</th><th class="n">Wind10</th><th class="n">fps</th><th class="n">ft‑lb</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>
    <div class="tiny" style="margin-top:8px">Screenshot this as a backup. Half the wind column for 5 mph, or for winds from 1, 5, 7 and 11 o'clock.</div>`);
}

/* ---------- Velocity truing ----------
   You shoot at distance, tell us what elevation actually hit center. We find the muzzle velocity that makes the
   solver agree, using today's conditions and angle. That "trued" velocity then drives every call. */
function elevAt(p, mv) { return BAL.solve({ ...p, mv, windMph: 0 }).at(p.rangeYd).elevMoa; }
function solveMv(p, wantMoa) {
  // Elevation needed falls as velocity rises, so bisect.
  let lo = p.mv * 0.75, hi = p.mv * 1.25;
  const eLo = elevAt(p, lo), eHi = elevAt(p, hi);
  if (wantMoa > eLo || wantMoa < eHi) return null; // more than ±25% off — something else is wrong
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2;
    if (elevAt(p, mid) > wantMoa) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

function trueIt() {
  const base = solution(); if (!base) return toast('Set load data first');
  const { r, b, c } = base; const u = r.unit === 'MIL' ? 'MIL' : 'MOA';
  const toU = m => r.unit === 'MIL' ? m / 3.43775 : m, fromU = x => r.unit === 'MIL' ? x * 3.43775 : x;
  const st = { range: Math.max(+c.range || 0, 300), dial: '', miss: '', missDir: 'low' };
  const predict = () => { const p = { ...base.p, rangeYd: st.range }; const a = BAL.solve({ ...p, windMph: 0 }).at(st.range); return { p, a }; };
  const last = b.trueLog && b.trueLog.length ? b.trueLog[b.trueLog.length - 1] : null;
  sheet('True your velocity', `
    <div class="muted" style="margin-bottom:12px">Your scope and the math agree up close. Far out, small errors in velocity add up. Shoot a 3‑shot group far away and tell me where it landed — I'll back out what your rifle <i>really</i> shoots.</div>
    <div class="tiny" style="margin-bottom:12px"><b>Best:</b> 600–900 yd, calm wind, conditions above set to today. Shoot from a solid rest.</div>
    <div class="field"><label>Distance you shot (yd)</label><input id="t_rng" class="num" inputmode="numeric" value="${st.range}"></div>
    <div class="field"><label>What you dialed (${u} up)</label><input id="t_dial" class="num" inputmode="decimal"></div>
    <div class="field"><label>Where the group's center hit, vs. your aim (inches)</label>
      <div class="row" style="align-items:center"><input id="t_miss" class="num" inputmode="decimal" placeholder="0" style="flex:1">
      <div class="seg" id="t_dir" style="flex:1.3"><button data-d="low" class="on">Low</button><button data-d="high">High</button></div></div>
      <div class="tiny" style="margin-top:4px">Dead center? Leave it 0. Ignore left/right — that's wind, not velocity.</div></div>
    <div id="t_out"></div>
    <button class="btn primary block" id="t_save" disabled>Use this velocity</button>
    ${last ? `<div class="tiny" style="margin-top:10px">Last trued ${esc(last.date)} at ${last.range} yd: ${last.from} → <b>${last.to} fps</b>.</div>` : ''}
    ${b.trueLog && b.trueLog.length ? `<button class="btn small block" id="t_undo" style="margin-top:8px">Undo last truing (back to ${b.trueLog[b.trueLog.length - 1].from} fps)</button>` : ''}`, el => {
    const out = $('#t_out', el), save1 = $('#t_save', el), dial = $('#t_dial', el);
    let result = null;
    const refresh = (fillDial) => {
      st.range = num($('#t_rng', el).value) || 0;
      if (st.range < 100) { out.innerHTML = ''; save1.disabled = true; return; }
      const { p, a } = predict(); if (!a) return;
      dial.placeholder = `app said ${f(toU(a.elevMoa), 2)}`;
      if (fillDial) dial.value = niceMoa(toU(a.elevMoa), r.click);
      const dialed = num(dial.value), missIn = num($('#t_miss', el).value) || 0;
      if (dialed == null) { out.innerHTML = ''; save1.disabled = true; return; }
      // Low impact means you needed MORE up. Inches → MOA at this range.
      const missMoa = Math.atan(missIn / 12 / (st.range * 3)) * 180 / Math.PI * 60;
      const want = fromU(dialed) + (st.missDir === 'low' ? missMoa : -missMoa);
      const mv = solveMv(p, want);
      if (!mv) { result = null; save1.disabled = true;
        out.innerHTML = `<div class="warn">That's too far off to be velocity (more than 25%). Check your zero at 100, the range, the conditions, and that your turret tracks.</div>`; return; }
      result = { mv: Math.round(mv), range: st.range, want };
      const d = result.mv - b.mv, pct = Math.abs(d) / b.mv * 100;
      const vAt = BAL.solve({ ...p, mv, windMph: 0 }).at(st.range);
      out.innerHTML = `
        <div class="sol" style="margin:6px 0 12px">
          <div class="k" style="text-align:center">YOUR RIFLE SHOOTS LIKE</div>
          <div class="num" style="text-align:center;font-size:44px;font-weight:800;line-height:1.1;margin:4px 0">${result.mv.toLocaleString()} <span style="font-size:18px;font-weight:600">fps</span></div>
          <div class="tiny" style="text-align:center">was ${Number(b.mv).toLocaleString()} fps · ${d === 0 ? 'no change' : `${d > 0 ? '+' : ''}${d} fps (${f(pct, 1)}%)`}</div>
          <div class="tiny" style="text-align:center;margin-top:6px">At ${st.range} yd you needed <b>${f(toU(want), 2)} ${u}</b> up; the app had ${f(toU(a.elevMoa), 2)}.</div>
        </div>
        ${pct > 4 ? `<div class="warn">That's a big change. Before saving, double‑check: 100‑yd zero still good, range is lasered, temp/altitude set to today, and your turret tracks true.</div>` : ''}
        ${vAt.mach < 1.2 ? `<div class="warn">The bullet is near the sound barrier at ${st.range} yd, where drag gets messy. True at a closer distance (where it's still fast) for the best result.</div>` : ''}`;
      save1.disabled = false;
    };
    $('#t_rng', el).oninput = () => refresh(false);
    dial.oninput = () => refresh(false);
    $('#t_miss', el).oninput = () => refresh(false);
    $('#t_dir', el).onclick = e => { const btn = e.target.closest('[data-d]'); if (!btn) return; st.missDir = btn.dataset.d;
      el.querySelectorAll('#t_dir button').forEach(x => x.classList.toggle('on', x === btn)); refresh(false); };
    save1.onclick = () => {
      if (!result) return;
      const bb = balOf(r);
      bb.trueLog = bb.trueLog || [];
      bb.trueLog.push({ wasEst: !!bb.mvEstimated, from: bb.mv, to: result.mv, range: result.range, date: new Date().toLocaleDateString(), cond: `${c.tempF}°F · ${c.altFt} ft` });
      bb.mv = result.mv; bb.mvEstimated = false; bb.trued = true;
      save(); closeSheet(); render(); toast(`Trued to ${result.mv} fps`);
    };
    const undo = $('#t_undo', el);
    if (undo) undo.onclick = () => { const bb = balOf(r), x = bb.trueLog.pop(); bb.mv = x.from; bb.mvEstimated = !!x.wasEst; bb.trued = bb.trueLog.length > 0;
      save(); closeSheet(); render(); toast(`Back to ${x.from} fps`); };
    refresh(true);
  });
}
