// Wave crests for the map. Incoming crests are lines of equal travel time over the real
// depths (eikonal equation, fast sweeping). The canyon edge is treated as a parabolic
// mirror that sends crests back to a focus off Praia do Norte.

import { bathymetry, depth, speeds } from "./physics.js";

const EDGE_DEPTH = 60;
const unit = (bearing) => [Math.sin(bearing * Math.PI / 180), Math.cos(bearing * Math.PI / 180)];

// depth grid with a 1-cell Gaussian blur
let smoothed = null;
function smoothDepth() {
  if (smoothed) return smoothed;
  const { nx, ny, h } = bathymetry();
  const k = [0.054, 0.242, 0.408, 0.242, 0.054];
  const a = Float32Array.from(h, (v) => Math.max(v, -5)), b = new Float32Array(a.length);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      let s = 0;
      for (let q = -2; q <= 2; q++) s += k[q + 2] * a[j * nx + Math.min(Math.max(i + q, 0), nx - 1)];
      b[j * nx + i] = s;
    }
  }
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      let s = 0;
      for (let q = -2; q <= 2; q++) s += k[q + 2] * b[Math.min(Math.max(j + q, 0), ny - 1) * nx + i];
      a[j * nx + i] = s;
    }
  }
  smoothed = a;
  return a;
}

// Arrival time (s) of a plane swell: |grad T| = 1 / c, fixed where it enters the grid
export function travelTime(period, direction) {
  const { nx, ny, x0, y0, dx } = bathymetry();
  const hs = smoothDepth();
  const [ux, uy] = unit(direction - 180);
  const cRef = speeds(period, 120)[0];
  const n = nx * ny;
  const T = new Float64Array(n).fill(Infinity);
  const f = new Float64Array(n);
  const sea = new Uint8Array(n), fixed = new Uint8Array(n);
  let aMin = Infinity;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const p = j * nx + i;
      sea[p] = hs[p] > 1 ? 1 : 0;
      if (sea[p]) f[p] = dx / speeds(period, hs[p])[0];
      aMin = Math.min(aMin, (x0 + i * dx) * ux + (y0 + j * dx) * uy);
    }
  }
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const p = j * nx + i;
      if (!sea[p]) continue;
      const along = (x0 + i * dx) * ux + (y0 + j * dx) * uy;
      const inflow = (i === 0 && ux > 0) || (i === nx - 1 && ux < 0) || (j === 0 && uy > 0) || (j === ny - 1 && uy < 0);
      if (along <= aMin + 2000 || inflow) { T[p] = (along - aMin) / cRef; fixed[p] = 1; }
    }
  }
  for (let iter = 0; iter < 3; iter++) {
    for (const [di, dj] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      for (let jj = 0; jj < ny; jj++) {
        const j = dj > 0 ? jj : ny - 1 - jj;
        for (let ii = 0; ii < nx; ii++) {
          const i = di > 0 ? ii : nx - 1 - ii;
          const p = j * nx + i;
          if (fixed[p] || !sea[p]) continue;
          const a = Math.min(i > 0 ? T[p - 1] : Infinity, i < nx - 1 ? T[p + 1] : Infinity);
          const b = Math.min(j > 0 ? T[p - nx] : Infinity, j < ny - 1 ? T[p + nx] : Infinity);
          if (a === Infinity && b === Infinity) continue;
          const fp = f[p];
          const t = Math.abs(a - b) >= fp ? Math.min(a, b) + fp : 0.5 * (a + b + Math.sqrt(2 * fp * fp - (a - b) ** 2));
          if (t < T[p]) T[p] = t;
        }
      }
    }
  }
  return T;
}

function sampleGrid(F, x, y) {
  const { nx, ny, x0, y0, dx } = bathymetry();
  const fx = (x - x0) / dx, fy = (y - y0) / dx;
  if (fx < 0 || fy < 0 || fx >= nx - 1 || fy >= ny - 1) return Infinity;
  const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j, p = j * nx + i;
  return (F[p] * (1 - tx) + F[p + 1] * tx) * (1 - ty) + (F[p + nx] * (1 - tx) + F[p + nx + 1] * tx) * ty;
}

// Parabola with its axis along the swell, fitted to the EDGE_DEPTH contour north of the canyon
export function mirror(direction) {
  const D = unit(direction - 180), E = [-D[1], D[0]];
  const edge = [];
  for (let x = -5000; x <= -800; x += 80) {
    for (let y = -600; y > -2600; y -= 40) {
      if (depth(x, y) >= EDGE_DEPTH) { edge.push([x, y]); break; }
    }
  }
  const fit = (fx, fy) => {
    let s1 = 0, s2 = 0;
    for (const [x, y] of edge) {
      const mx = x - fx, my = y - fy, v = Math.hypot(mx, my) + mx * D[0] + my * D[1];
      s1 += v; s2 += v * v;
    }
    const mean = s1 / edge.length;
    return [mean, Math.sqrt(Math.max(s2 / edge.length - mean * mean, 0))];
  };
  let best = null;
  for (let fx = -1800; fx <= -350; fx += 50) {
    for (let fy = -1000; fy <= 1200; fy += 50) {
      const h = depth(fx, fy);
      if (!(h > 4 && h < 15)) continue;
      const [C, err] = fit(fx, fy);
      if (!best || err < best.err) best = { F: [fx, fy], C, err };
    }
  }
  if (!best) return null;
  const psi = edge.map(([x, y]) => {
    const mx = x - best.F[0], my = y - best.F[1];
    return Math.atan2(mx * E[0] + my * E[1], mx * D[0] + my * D[1]);
  });
  return { ...best, D, E, edge, psiLo: Math.min(...psi), psiHi: Math.max(...psi) };
}

// Rough energy pattern: focus north of the canyon, shadow south of it
function energyAt(x, y, focus) {
  const blob = (cx, cy, sx, sy) => Math.exp(-0.5 * (((x - cx) / sx) ** 2 + ((y - cy) / sy) ** 2));
  return 1 + 1.3 * focus * blob(-1300, 0, 1200, 1400) - 0.9 * blob(-1200, -3200, 1600, 1200);
}

export class CrestField {
  constructor(fc) {
    this.period = fc.period;
    this.T = travelTime(fc.period, fc.direction);
    this.mirror = mirror(fc.direction);
    this.cShelf = speeds(fc.period, 20)[0];
    this.focus = Math.min(Math.max((fc.canyonGain - 1) / 0.8, 0.35), 1);
    if (this.mirror) {
      const { F, edge } = this.mirror;
      let s = 0;
      for (const [x, y] of edge) s += sampleGrid(this.T, x, y) + Math.hypot(x - F[0], y - F[1]) / this.cShelf;
      this.tFocus = s / edge.length;
    }
    this.view = null;
  }

  get peak() { return this.mirror?.F; }

  setView(xa, xb, ya, yb, step) {
    const nx = Math.ceil((xb - xa) / step) + 1, ny = Math.ceil((yb - ya) / step) + 1;
    const n = nx * ny;
    const T = new Float32Array(n), Ev = new Float32Array(n), R = new Float32Array(n);
    const m = this.mirror;
    for (let j = 0; j < ny; j++) {
      const y = ya + j * step;
      for (let i = 0; i < nx; i++) {
        const x = xa + i * step, p = j * nx + i;
        const t = sampleGrid(this.T, x, y);
        const wet = Number.isFinite(t) && depth(x, y) > 0.5;
        T[p] = wet ? t : NaN;
        Ev[p] = energyAt(x, y, this.focus);
        R[p] = NaN;
        if (wet && m) {
          const rx = x - m.F[0], ry = y - m.F[1], r = Math.hypot(rx, ry);
          const psi = Math.atan2(rx * m.E[0] + ry * m.E[1], rx * m.D[0] + ry * m.D[1]);
          if (psi >= m.psiLo && psi <= m.psiHi && r < m.C / (1 + Math.cos(psi)) && r > 40) {
            R[p] = this.tFocus - r / this.cShelf;
          }
        }
      }
    }
    this.view = { xa, ya, step, nx, ny, T: cells(T), R: cells(R) };

    function cells(F) {
      const idx = [], lo = [], hi = [], en = [];
      for (let j = 0; j < ny - 1; j++) {
        for (let i = 0; i < nx - 1; i++) {
          const p = j * nx + i;
          const a = F[p], b = F[p + 1], c = F[p + nx + 1], d = F[p + nx];
          if (Number.isNaN(a) || Number.isNaN(b) || Number.isNaN(c) || Number.isNaN(d)) continue;
          idx.push(p);
          lo.push(Math.min(a, b, c, d));
          hi.push(Math.max(a, b, c, d));
          en.push(0.25 * (Ev[p] + Ev[p + 1] + Ev[p + nx] + Ev[p + nx + 1]));
        }
      }
      return { F, idx: Int32Array.from(idx), lo: Float32Array.from(lo), hi: Float32Array.from(hi), en: Float32Array.from(en) };
    }
  }

  // Marching squares at times phase + k * period
  contours(field, phase, emit) {
    const { xa, ya, step, nx } = this.view;
    const { F, idx, lo, hi, en } = this.view[field], P = this.period;
    const pt = [0, 0, 0, 0, 0, 0, 0, 0];
    for (let q = 0; q < idx.length; q++) {
      let k = Math.ceil((lo[q] - phase) / P);
      const kEnd = Math.floor((hi[q] - phase) / P);
      if (k > kEnd) continue;
      const p = idx[q], i = p % nx, j = (p - i) / nx;
      const a = F[p], b = F[p + 1], c = F[p + nx + 1], d = F[p + nx];
      const x = xa + i * step, y = ya + j * step, e = en[q];
      for (; k <= kEnd; k++) {
        const L = phase + k * P;
        let m = 0;
        if ((a < L) !== (b < L)) { pt[m++] = x + step * (L - a) / (b - a); pt[m++] = y; }
        if ((b < L) !== (c < L)) { pt[m++] = x + step; pt[m++] = y + step * (L - b) / (c - b); }
        if ((c < L) !== (d < L)) { pt[m++] = x + step * (1 - (L - c) / (d - c)); pt[m++] = y + step; }
        if ((d < L) !== (a < L)) { pt[m++] = x; pt[m++] = y + step * (1 - (L - d) / (a - d)); }
        if (m >= 4) emit(pt[0], pt[1], pt[2], pt[3], e);
        if (m === 8) emit(pt[4], pt[5], pt[6], pt[7], e);
      }
    }
  }
}
