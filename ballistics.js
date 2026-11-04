'use strict';
/* Zero In ballistic solver — 3‑DOF point‑mass model with standard G1/G7 drag tables.
   Units inside: feet, seconds, slugs, °R. Inputs/outputs in shooter units (yd, in, fps, °F, inHg, mph, MOA).
   Accounts for: drag vs. Mach, air density (temp, pressure, humidity), speed of sound, shot angle
   (gravity resolved along the line of sight), full 3‑D wind, sight height, zero range/offset, spin drift (Litz). */

const BAL = (() => {
  const G = 32.174; // ft/s²
  const DRAG_K = 2.08551e-4; // ρ0·π/8 converted for BC in lb/in² (standard sea‑level density 0.0764742 lb/ft³)
  const RHO0 = 0.0764742; // lb/ft³

  function cd(table, mach) {
    if (mach <= table[0][0]) return table[0][1];
    for (let i = 1; i < table.length; i++) {
      if (mach <= table[i][0]) {
        const [m0, c0] = table[i - 1], [m1, c1] = table[i];
        return c0 + (c1 - c0) * (mach - m0) / (m1 - m0);
      }
    }
    return table[table.length - 1][1];
  }

  // Station pressure (inHg) at altitude (ft) in the ICAO standard atmosphere.
  const pressureAtAlt = altFt => 29.9213 * Math.pow(1 - 6.8756e-6 * altFt, 5.2559);
  const stdTempAtAlt = altFt => 59 - 0.00356616 * altFt; // °F

  // Air density (lb/ft³) and speed of sound (ft/s) from temp °F, station pressure inHg, humidity %.
  function air({ tempF = 59, pressureInHg = 29.92, humidity = 50 }) {
    const Tc = (tempF - 32) * 5 / 9, Tk = Tc + 273.15;
    const Pa = pressureInHg * 3386.389;
    const es = 610.78 * Math.pow(10, 7.5 * Tc / (Tc + 237.3)); // saturation vapor pressure, Pa
    const pv = Math.max(0, Math.min(100, humidity)) / 100 * es;
    const rhoSI = (Pa - pv) / (287.058 * Tk) + pv / (461.495 * Tk); // kg/m³
    const rho = rhoSI * 0.062428; // lb/ft³
    const sos = Math.sqrt(1.4 * 287.058 * Tk) * 3.28084 * (1 + 0.0016 * pv / Pa); // small humidity effect
    return { rho, densityRatio: rho / RHO0, sos };
  }

  /* Integrate a trajectory.
     opts: { bc, model:'G7'|'G1', mv (fps), sightHeight (in), boreAngle (rad, above LOS), lookAngle (deg),
             atm:{tempF,pressureInHg,humidity}, windMph, windFromClock (1‑12; 12 = headwind, 3 = from right),
             maxRangeYd, stepYd } → rows at every stepYd */
  function fly(o) {
    const table = o.model === 'G1' ? DRAG_G1 : DRAG_G7;
    const a = air(o.atm || {});
    const look = (o.lookAngle || 0) * Math.PI / 180;
    // Line‑of‑sight frame: x downrange along LOS, y "up" perpendicular to LOS, z right.
    const gx = -G * Math.sin(look), gy = -G * Math.cos(look);
    // Wind: clock position the wind comes FROM. 3 o'clock = from the right (blows toward −z).
    const wmag = (o.windMph || 0) * 1.46667;
    const th = ((o.windFromClock || 3) % 12) * Math.PI / 6; // 0 at 12 o'clock
    const wx = -wmag * Math.cos(th);   // headwind (12) blows toward shooter (−x)
    const wz = -wmag * Math.sin(th);   // from right (3) blows left (−z)
    let x = 0, y = -(o.sightHeight || 1.5) / 12, z = 0, t = 0;
    let vx = o.mv * Math.cos(o.boreAngle), vy = o.mv * Math.sin(o.boreAngle), vz = 0;
    const k = DRAG_K * a.densityRatio / o.bc;
    const stepFt = (o.stepYd || 25) * 3, maxFt = (o.maxRangeYd || 1000) * 3;
    const rows = []; let next = 0;
    const acc = (vx, vy, vz) => {
      const rx = vx - wx, ry = vy, rz = vz - wz;
      const v = Math.hypot(rx, ry, rz);
      const d = k * cd(table, v / a.sos) * v;
      return [-d * rx + gx, -d * ry + gy, -d * rz];
    };
    rows.push({ x: 0, y, z, t: 0, v: o.mv }); next = stepFt;
    while (next <= maxFt + 1e-6 && t < 10 && vx > 0) {
      const v = Math.hypot(vx, vy, vz);
      const dt = Math.min(0.0005, 1.5 / v); // ~1.5 ft per step
      // RK4 on the full state [pos, vel]
      const f = (s) => { const ac = acc(s[3], s[4], s[5]); return [s[3], s[4], s[5], ac[0], ac[1], ac[2]]; };
      const S = [x, y, z, vx, vy, vz];
      const k1 = f(S);
      const k2 = f(S.map((q, i) => q + k1[i] * dt / 2));
      const k3 = f(S.map((q, i) => q + k2[i] * dt / 2));
      const k4 = f(S.map((q, i) => q + k3[i] * dt));
      const N = S.map((q, i) => q + (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]) * dt / 6);
      while (N[0] >= next && next <= maxFt + 1e-6) {
        const w = (next - x) / (N[0] - x);
        const L = (i) => S[i] + w * (N[i] - S[i]);
        rows.push({ x: next, y: L(1), z: L(2), t: t + w * dt, v: Math.hypot(L(3), L(4), L(5)) });
        next += stepFt;
      }
      [x, y, z, vx, vy, vz] = N; t += dt;
    }
    return { rows, air: a };
  }

  // Bore angle that puts the bullet `offsetIn` above LOS at `zeroYd` (zeroed flat, in zero atmosphere, no wind).
  function zeroAngle(o) {
    let ang = 0.001;
    for (let i = 0; i < 30; i++) {
      const r = fly({ ...o, boreAngle: ang, lookAngle: 0, windMph: 0, maxRangeYd: o.zeroYd, stepYd: o.zeroYd });
      const last = r.rows[r.rows.length - 1];
      const err = (o.zeroOffsetIn || 0) / 12 - last.y; // ft
      if (Math.abs(err) < 1e-5) break;
      ang += err / (o.zeroYd * 3);
    }
    return ang;
  }

  // Miller stability factor; returns null if bullet length unknown.
  function millerSg({ weightGr, diameterIn, lengthIn, twistIn, mv, atm }) {
    if (!weightGr || !diameterIn || !lengthIn || !twistIn) return null;
    const t = twistIn / diameterIn, l = lengthIn / diameterIn;
    let sg = 30 * weightGr / (t * t * Math.pow(diameterIn, 3) * l * (1 + l * l));
    sg *= Math.cbrt(mv / 2800);
    const T = (atm && atm.tempF != null ? atm.tempF : 59), P = (atm && atm.pressureInHg) || 29.92;
    return sg * ((T + 460) / 519) * (29.92 / P);
  }

  /* Full solution for one shot. p = profile + conditions:
     { bc, model, mv, sightHeight, zeroYd, zeroOffsetIn, twistIn, twistDir:'right'|'left', weightGr, diameterIn, lengthIn,
       rangeYd, lookAngle, atm, windMph, windFromClock } */
  function solve(p, extraRanges) {
    const zeroAtm = p.zeroAtm || { tempF: 59, pressureInHg: 29.92, humidity: 50 };
    const bore = zeroAngle({ bc: p.bc, model: p.model, mv: p.mv, sightHeight: p.sightHeight, zeroYd: p.zeroYd || 100, zeroOffsetIn: p.zeroOffsetIn || 0, atm: zeroAtm });
    const step = 25;
    const maxR = Math.max(p.rangeYd || 0, ...(extraRanges || [0]));
    const fl = fly({ bc: p.bc, model: p.model, mv: p.mv, sightHeight: p.sightHeight, boreAngle: bore, lookAngle: p.lookAngle || 0,
      atm: p.atm, windMph: p.windMph, windFromClock: p.windFromClock, maxRangeYd: Math.ceil(maxR / step) * step + step, stepYd: step });
    const sg = millerSg({ ...p, atm: p.atm }) ?? 1.5;
    const sign = p.twistDir === 'left' ? -1 : 1;
    const weightLb = (p.weightGr || 0) / 7000;
    const at = yd => {
      const xf = yd * 3, rows = fl.rows;
      let i = rows.findIndex(r => r.x >= xf - 1e-6);
      if (i < 0) return null;
      let r = rows[i];
      if (i > 0 && rows[i].x > xf + 1e-6) { const a = rows[i - 1], b = rows[i], f = (xf - a.x) / (b.x - a.x);
        r = { x: xf, y: a.y + f * (b.y - a.y), z: a.z + f * (b.z - a.z), t: a.t + f * (b.t - a.t), v: a.v + f * (b.v - a.v) }; }
      const spinIn = sign * 1.25 * (sg + 1.2) * Math.pow(r.t, 1.83); // Litz
      const dropIn = r.y * 12, windIn = r.z * 12 + spinIn;
      const toMoa = inch => yd > 0 ? Math.atan(inch / 12 / xf) * 180 / Math.PI * 60 : 0;
      return {
        rangeYd: yd, dropIn, windIn, spinIn, tof: r.t, vel: r.v,
        energy: weightLb ? 0.5 * (weightLb / G) * r.v * r.v : null,
        elevMoa: -toMoa(dropIn),           // + = dial UP
        windMoa: -toMoa(windIn),           // + = dial/hold RIGHT
        mach: r.v / fl.air.sos,
      };
    };
    return { at, sg, air: fl.air, bore };
  }

  return { solve, air, pressureAtAlt, stdTempAtAlt, millerSg, fly, zeroAngle };
})();
if (typeof module !== 'undefined') module.exports = BAL;
