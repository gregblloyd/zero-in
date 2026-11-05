'use strict';
/* Load workup coach. Reads a load's tests and tells you what they mean and what to load next:
   seating (lands / jump / factory reference), velocity trend + projection, scatter, pressure signs, next ladder.
   Uses globals from app.js (S, $, esc, f, num, stats, save, toast, sheet, closeSheet, uid, render, velEntry, ladder, editTest). */

const PRESS = [['primer', 'Flat or cratered primer'], ['eject', 'Ejector mark on case head'], ['bolt', 'Heavy / sticky bolt lift'],
  ['pocket', 'Loose primer pocket'], ['pierce', 'Pierced or blanked primer'], ['other', 'Something else (see notes)']];
const f3 = x => x == null || isNaN(x) ? '–' : (+x).toFixed(3);
const r05 = x => Math.round(x * 2) / 2;

// Jump in inches: + = off the lands, − = jammed into them.
function jumpOf(l, cbto) { const L = num(l.lands), c = num(cbto); return L && c ? L - c : null; }
function jumpTxt(j) {
  if (j == null) return '';
  if (j < -0.0015) return `${f3(-j)} INTO the lands (jammed)`;
  if (j < 0.003) return 'touching the lands';
  return `${f3(j)} off the lands`;
}
const lenParse = t => String(t).split(/[\s,;]+/).map(num).filter(x => x && x > 0.5 && x < 5);
const lenStats = v => { if (!v.length) return null; const avg = v.reduce((a, b) => a + b, 0) / v.length; return { n: v.length, avg, es: Math.max(...v) - Math.min(...v), min: Math.min(...v), max: Math.max(...v) }; };
const lenStatsHtml = s => `<div class="grid2"><div class="stat"><span>Readings</span><b class="num">${s.n}</b></div><div class="stat"><span>Average</span><b class="num">${s.avg.toFixed(4)}"</b></div><div class="stat"><span>Spread</span><b class="num">${s.es.toFixed(4)}"</b></div><div class="stat"><span>Use</span><b class="num">${s.avg.toFixed(3)}"</b></div></div>`;

// Velocity by charge (tests at the same charge are pooled).
function trend(l) {
  const by = {};
  (l.tests || []).forEach(t => { if (t.charge == null || !(t.vels || []).length) return; (by[t.charge] = by[t.charge] || []).push(...t.vels); });
  const pts = Object.keys(by).map(Number).sort((a, b) => a - b).map(c => ({ c, s: stats(by[c]) }));
  const out = { pts };
  if (pts.length < 2) return out;
  const fit = pts.slice(-4); // the top of the curve is what you project from
  const n = fit.length, mx = fit.reduce((a, p) => a + p.c, 0) / n, my = fit.reduce((a, p) => a + p.s.avg, 0) / n;
  const den = fit.reduce((a, p) => a + (p.c - mx) ** 2, 0);
  out.slope = den ? fit.reduce((a, p) => a + (p.c - mx) * (p.s.avg - my), 0) / den : 0; // fps per grain
  out.icpt = my - out.slope * mx;
  const all = pts.length > 2 ? (pts[pts.length - 1].s.avg - pts[0].s.avg) / (pts[pts.length - 1].c - pts[0].c) : out.slope;
  out.steps = pts.slice(1).map((p, i) => { const per = (p.s.avg - pts[i].s.avg) / (p.c - pts[i].c);
    return { a: pts[i], b: p, per, flat: all > 0 && per < all * 0.4, jump: all > 0 && per > all * 1.8 }; });
  return out;
}
const chargeFor = (tr, v) => tr.slope > 5 ? (v - tr.icpt) / tr.slope : null;

function coachHtml(l) {
  const tests = l.tests || [];
  const tr = trend(l);
  const parts = [];
  const lands = num(l.lands), cb = num(l.cbto), fac = num(l.factoryCbto);
  const max = num(l.max);
  const pressured = tests.filter(t => (t.press || []).length && t.charge != null).sort((a, b) => a.charge - b.charge);
  const firstP = pressured[0];
  const tgtLo = num(l.targetLo), tgtHi = num(l.targetHi) || tgtLo;

  // ---- 1. Seating ----
  parts.push(`<div class="co-sec"><div class="co-h">Seating depth <span class="tiny">(base to ogive)</span></div>
    <div class="co-grid">
      <button class="co-cell" id="co_lands"><span>Lands · touch</span><b class="num">${lands ? f3(lands) + '"' : 'Measure'}</b><small>${(l.landsLog || []).length ? `avg of ${l.landsLog.length}, spread ${lenStats(l.landsLog).es.toFixed(4)}` : 'OAL gauge + comparator'}</small></button>
      <button class="co-cell" id="co_fac"><span>Factory round</span><b class="num">${fac ? f3(fac) + '"' : 'Measure'}</b><small>${fac && lands ? jumpTxt(lands - fac) : 'the load you know shoots'}</small></button>
      <button class="co-cell" id="co_cb"><span>Your load</span><b class="num">${cb ? f3(cb) + '"' : 'Set'}</b><small>${cb && lands ? jumpTxt(lands - cb) : 'CBTO you seat to'}</small></button>
    </div>
    ${cb && lands && lands - cb < -0.0015 ? `<div class="warn">Jammed into the lands. That raises pressure and makes velocity jump around. Seat back before the next ladder.</div>` : ''}
    ${lands && fac && cb && Math.abs(cb - fac) > 0.004 && !tr.pts.length ? `<div class="co-tip">Tip: for your first velocity ladder, seat to the factory number (${f3(fac)}"). You already know that depth shoots in this rifle. Change one thing at a time.</div>` : ''}
    ${lands ? `<button class="btn small" id="co_seat">Build a seating test</button>` : '<div class="tiny">Measure your lands first. Everything about seating is measured from that number.</div>'}
  </div>`);

  // ---- 2. Pressure ----
  if (firstP) {
    const fired = t => (t.vels || []).length || t.group != null;
    const clean = tests.filter(t => t.charge != null && t.charge < firstP.charge && fired(t) && !(t.press || []).length).map(t => t.charge);
    const top = clean.length ? Math.max(...clean) : null;
    parts.push(`<div class="co-sec"><div class="warn" style="margin:0"><b>Pressure signs at ${f(firstP.charge, 1)} gr</b> (${esc((firstP.press || []).map(k => (PRESS.find(p => p[0] === k) || [, k])[1]).join(', '))}).
      Stop going up. ${top != null ? `Your highest clean charge is ${f(top, 1)} gr. Pick your load at or below that, ideally a step or two lower for hot days.` : 'Back off at least 2–3% and work up again.'}</div></div>`);
  }

  // ---- 3. Velocity trend ----
  if (tr.pts.length >= 2) {
    const per = tr.slope * 0.5;
    const flags = tr.steps.filter(s => s.flat || s.jump);
    const proj = [];
    const top = tr.pts[tr.pts.length - 1].c;
    if (tr.slope > 5) for (let c = r05(top) + 0.5, k = 0; k < 4; c += 0.5, k++) { if (max && c > max + 1e-6) break; proj.push([c, tr.icpt + tr.slope * c]); }
    parts.push(`<div class="co-sec"><div class="co-h">Velocity curve</div>
      <div class="co-line">${tr.slope > 0 ? `Gaining <b>${f(per, 0)} fps per ½ grain</b> across your last ${Math.min(4, tr.pts.length)} charges.` : 'Velocity is not rising with charge. Check your chrono data.'}</div>
      ${flags.map(s => s.jump
        ? `<div class="co-flag bad">⚠ ${f(s.a.c, 1)} → ${f(s.b.c, 1)} gr jumped ${f(s.per * 0.5, 0)} fps per ½ gr (much more than the trend). A sudden jump is a pressure warning — check primers and bolt lift.</div>`
        : `<div class="co-flag">◆ ${f(s.a.c, 1)} → ${f(s.b.c, 1)} gr flattened (${f(s.per * 0.5, 0)} fps per ½ gr). Low in the range that can be a forgiving "node" — note the groups there. Near max, flattening can be an early pressure sign.</div>`).join('')}
      ${proj.length && !firstP ? `<div class="co-line">If the trend holds: ${proj.map(([c, v]) => `<b>${f(c, 1)}</b> → ~${Math.round(v / 5) * 5}`).join(' · ')} fps${max ? ` (manual max ${f(max, 1)})` : ''}. Projections are a guide, not a promise — watch for pressure every step.</div>` : ''}
    </div>`);
  }

  // ---- 4. Consistency (ES / SD) ----
  const withN = tests.filter(t => (t.vels || []).length >= 3).map(t => ({ t, s: stats(t.vels) }));
  if (withN.length) {
    const es = withN.map(x => x.s.es).sort((a, b) => a - b), med = es[Math.floor(es.length / 2)];
    const bad = withN.filter(x => x.s.es > Math.max(2 * med, 35));
    const good = withN.filter(x => x.s.n >= 5 && x.s.sd <= 10);
    parts.push(`<div class="co-sec"><div class="co-h">Consistency</div>
      ${bad.map(x => `<div class="co-flag bad">⚠ ${f(x.t.charge, 1)} gr spread ${f(x.s.es, 0)} fps (${x.s.min}–${x.s.max}). Scatter isn't pressure — it's usually the ammo: charges not weighed to 0.1 gr, uneven neck tension, or seated near/into the lands.</div>`).join('')}
      ${good.length ? `<div class="co-flag good">✓ ${good.map(x => `${f(x.t.charge, 1)} gr SD ${f(x.s.sd, 1)}`).join(', ')} — single‑digit SD over 5+ shots is excellent.</div>` : ''}
      <div class="tiny">Targets: SD under 10 fps is match‑grade, under 15 is great for hunting. Judge SD on 5+ shots; 3 shots only hint.</div>
    </div>`);
  }

  // ---- 5. Next step ----
  let next = '', nextBtn = '';
  const seatTests = tests.filter(t => num(t.cbto) && cb && Math.abs(num(t.cbto) - cb) > 0.004);
  if (firstP) next = `Choose a charge at or below your last clean one, then confirm it with a 5‑shot group over the chrono.`;
  else if (!lands) next = `Measure your lands (touch point) with the OAL gauge and comparator. Take 5–10 readings; the app averages them.`;
  else if (!tr.pts.length) next = `Load a velocity ladder: ½ grain steps from the manual start, 3 rounds each, weighed to 0.1 gr, seated ${fac ? `to factory (${f3(fac)}")` : 'to one fixed depth'}. Check primers after every shot.`;
  else if (tgtLo && tr.slope > 5) {
    const c1 = chargeFor(tr, tgtLo), c2 = chargeFor(tr, tgtHi), topT = tr.pts[tr.pts.length - 1].c;
    let s0 = r05(Math.min(c1, c2) - 1), e0 = r05(Math.max(c1, c2) + 1);
    s0 = Math.max(s0, r05(topT) + 0.5); if (max) e0 = Math.min(e0, Math.floor(max * 2) / 2); // start above what you've shot, never past book max
    if (topT >= Math.max(c1, c2)) next = `You've reached your goal velocity (${tgtLo}${tgtHi !== tgtLo ? `–${tgtHi}` : ''} fps). Pick the charge with the best group and tightest SD there, then ${seatTests.length ? 'confirm it with a 5‑shot group.' : 'run a seating test at that charge.'}`;
    else if (e0 >= s0) { next = `Goal ${tgtLo}${tgtHi !== tgtLo ? `–${tgtHi}` : ''} fps should land around <b>${f(c1, 1)}${c2 !== c1 ? `–${f(c2, 1)}` : ''} gr</b>. Next ladder: <b>${f(s0, 1)} to ${f(e0, 1)} gr</b> in ½ grain steps, 3 rounds each${cb ? `, CBTO ${f3(cb)}"` : ''}.`;
      nextBtn = `<button class="btn small primary" id="co_next" data-s="${s0}" data-e="${e0}">Build that ladder</button>`; }
    else next = `Your goal looks to be above your manual max. Settle for the best charge below max — don't chase velocity past book.`;
  } else next = `Set a goal velocity (Edit load). Use what factory ammo chronographs in your rifle. Then I'll project the charge and build your next ladder.`;
  parts.push(`<div class="co-sec"><div class="co-h">Next step</div><div class="co-line">${next}</div>${nextBtn}</div>`);

  return `<h2>Workup coach</h2><div class="card coach">${parts.join('')}
    <details class="co-sec"><summary class="co-h" style="cursor:pointer">The pro workup, step by step</summary>
      <ol class="co-steps">
        ${[[lands, 'Measure lands (touch) with an OAL gauge — 5–10 readings, average them.'],
           [fac, 'Measure a factory round the same way. Its jump is a proven starting point.'],
           [tr.pts.length >= 4, 'Velocity ladder: ½ gr steps, 3 rounds each, one seating depth, charges weighed to 0.1 gr. Check primers every shot.'],
           [tgtLo && tr.pts.some(p => p.s.avg >= tgtLo), 'Find the charge that hits your goal velocity with a flat spot and tight SD.'],
           [seatTests.length, 'Seating test at that charge: step the jump (.020–.120 for ELD‑X) and shoot groups.'],
           [l.status === 'keeper', 'Confirm: 5‑shot groups + chrono, ideally on two days. Mark the load Keeper.']]
          .map(([done, t]) => `<li class="${done ? 'done' : ''}">${t}</li>`).join('')}
      </ol>
      <div class="tiny">One variable at a time. Same brass, primer lot, and powder lot through the whole workup.</div>
    </details></div>`;
}

function bindCoach(v, l) {
  const q = s => v.querySelector(s);
  if (q('#co_lands')) q('#co_lands').onclick = () => measureSheet(l, 'lands');
  if (q('#co_fac')) q('#co_fac').onclick = () => measureSheet(l, 'factory');
  if (q('#co_cb')) q('#co_cb').onclick = () => measureSheet(l, 'cbto');
  if (q('#co_seat')) q('#co_seat').onclick = () => seatingTest(l);
  if (q('#co_next')) q('#co_next').onclick = e => ladder(l, { s: +e.target.dataset.s, e: +e.target.dataset.e, step: 0.5, cbto: l.cbto });
}

function measureSheet(l, kind) {
  const meta = {
    lands: { title: 'Measure your lands', key: 'landsLog', field: 'lands',
      how: 'Hornady OAL gauge + modified case, then base‑to‑ogive with the comparator. Zero the caliper with the comparator on. Push the bullet gently until it stops — don\'t ram it. Take 5–10 readings.' },
    factory: { title: 'Measure a factory round', key: 'factoryLog', field: 'factoryCbto',
      how: 'Same comparator, same caliper setup. Measure 3–5 factory rounds base to ogive. This tells you the jump the ammo you like is running.' },
    cbto: { title: 'Your seating depth', key: 'cbtoLog', field: 'cbto',
      how: 'Measure a few of your loaded rounds base to ogive (or enter the depth you plan to seat to).' },
  }[kind];
  let vals = [...(l[meta.key] || [])];
  if (!vals.length && num(l[meta.field])) vals = [num(l[meta.field])];
  sheet(meta.title, `<div class="muted" style="margin-bottom:12px">${meta.how}</div><div id="m_in"></div>
    <div id="m_jump" class="co-line" style="margin-top:10px"></div>
    <button class="btn primary block" id="m_save" style="margin-top:12px">Save</button>`, el => {
    const showJump = vs => { const s = lenStats(vs); const L = kind === 'lands' ? (s && s.avg) : num(l.lands);
      const c = kind === 'lands' ? num(l.cbto) : (s && s.avg);
      $('#m_jump', el).innerHTML = L && c ? `${kind === 'lands' ? 'Your load' : 'That'} is <b>${jumpTxt(L - c)}</b>.` : ''; };
    const get = velEntry($('#m_in', el), vals, showJump, { parse: lenParse, round: x => Math.round(x * 10000) / 10000, word: 'Reading', unit: 'in',
      inputmode: 'decimal', statsHtml: lenStatsHtml, hiWord: 'longest', loWord: 'shortest',
      hint: 'Type one reading (like 2.6575), tap Add reading, repeat. I\'ll average them.' });
    showJump(vals);
    $('#m_save', el).onclick = () => {
      const vs = get(); const s = lenStats(vs);
      l[meta.key] = vs; l[meta.field] = s ? s.avg.toFixed(4) : '';
      if (s && s.es > 0.006 && kind === 'lands') toast('Readings spread over .006" — consider re-measuring');
      save(); closeSheet(); render();
    };
  });
}

function seatingTest(l) {
  const lands = num(l.lands); if (!lands) return toast('Measure your lands first');
  const berger = /berger/i.test(l.bullet || '');
  const jumps = berger ? [0.010, 0.040, 0.070, 0.100, 0.130] : [0.020, 0.040, 0.060, 0.080, 0.100, 0.120];
  const tr = trend(l), best = bestTest(l);
  const guess = best ? best.charge : tr.pts.length ? tr.pts[tr.pts.length - 1].c : '';
  sheet('Seating depth test', `
    <div class="muted" style="margin-bottom:12px">Same charge, step the jump. Shoot a 3–5 shot group at each and keep the one that groups best${berger ? ' (Berger recommends .010 / .040 / .070 / .100 off, then fine‑tune)' : '. ELD‑X and other hunting bullets often like a long jump, .060–.120'}.</div>
    <div class="field"><label>Charge for the whole test (gr)</label><input id="s_c" class="num" inputmode="decimal" value="${guess}"></div>
    <div class="field"><label>Jumps to test (inches off the lands)</label><div class="chips" id="s_j">${jumps.map(j => `<button data-j="${j}" class="on">.${String(Math.round(j * 1000)).padStart(3, '0')}</button>`).join('')}</div></div>
    <div id="s_prev" class="tiny"></div>
    <button class="btn primary block" id="s_go" style="margin-top:12px">Create test rows</button>`, el => {
    const sel = () => [...el.querySelectorAll('#s_j button.on')].map(b => +b.dataset.j);
    const prev = () => { $('#s_prev', el).innerHTML = sel().map(j => `${f3(j)} off → CBTO <b>${f3(lands - j)}"</b>`).join('<br>'); };
    $('#s_j', el).onclick = e => { const b = e.target.closest('button'); if (!b) return; b.classList.toggle('on'); prev(); };
    prev();
    $('#s_go', el).onclick = () => {
      const c = num($('#s_c', el).value), js = sel();
      if (!c) return toast('Enter the charge'); if (!js.length) return toast('Pick at least one jump');
      if (l.max && c > num(l.max)) return toast('That charge is over your manual max');
      l.tests = l.tests || [];
      js.forEach(j => l.tests.push({ id: uid(), charge: c, cbto: (lands - j).toFixed(3), date: new Date().toISOString().slice(0, 10), distance: 100, rifleId: S.activeRifle, vels: [] }));
      save(); closeSheet(); render(); toast(`${js.length} seating rows added`);
    };
  });
}
