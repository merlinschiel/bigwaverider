// Wave physics: one wave at one spot, the peak just north of the canyon.
//   w^2 = g k tanh(k h)               dispersion
//   sin(a_c) = c_shelf / c_canyon     critical angle at the canyon edge
//   H = (1 + R) Ks Hs                 R: share turned back by the edge, Ks: shoaling
//   H_b = 0.78 h_b                    breaking
// Coordinates in metres, x east, y north.

export const G = 9.81;
export const RHO = 1025;
export const GAMMA = 0.78;
export const SET_FACTOR = 1.8;          // biggest of ~1000 waves, x Hs

// 80 m depth grid from tools/build_bathymetry.py

let bathy = null;

export async function loadBathymetry() {
  if (bathy) return bathy;
  const base = new URL("../data/", import.meta.url);
  const version = new URL(import.meta.url).search;
  const get = (name) => fetch(new URL(name + version, base)).then((r) => {
    if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
    return r;
  });
  const [meta, bin] = await Promise.all([
    get("bathymetry.json").then((r) => r.json()),
    get("bathymetry.bin").then((r) => r.arrayBuffer()),
  ]);
  const raw = new Int16Array(bin);
  const h = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) h[i] = raw[i] / 10;
  bathy = { ...meta, h, shore: Float32Array.from(meta.shoreline) };
  return bathy;
}

export const bathymetryCredit = () => bathy?.credit ?? "";
export const bathymetry = () => bathy;

function cubicW(t, out) {
  const t2 = t * t, t3 = t2 * t;
  out[0] = -0.5 * t3 + t2 - 0.5 * t;
  out[1] = 1.5 * t3 - 2.5 * t2 + 1;
  out[2] = -1.5 * t3 + 2 * t2 + 0.5 * t;
  out[3] = 0.5 * t3 - 0.5 * t2;
}
const WX = new Float64Array(4), WY = new Float64Array(4);

export function depth(x, y) {
  const { x0, y0, dx, nx, ny, h } = bathy;
  const fx = Math.min(Math.max((x - x0) / dx, 1), nx - 2.001);
  const fy = Math.min(Math.max((y - y0) / dx, 1), ny - 2.001);
  const i = Math.floor(fx), j = Math.floor(fy);
  cubicW(fx - i, WX);
  cubicW(fy - j, WY);
  let v = 0;
  for (let b = 0; b < 4; b++) {
    const row = (j - 1 + b) * nx + i - 1;
    v += WY[b] * (WX[0] * h[row] + WX[1] * h[row + 1] + WX[2] * h[row + 2] + WX[3] * h[row + 3]);
  }
  return v;
}

// x of the mainland shoreline (first land seen from the west) at latitude y
export function shorelineX(y) {
  const { y0, dx, ny, shore } = bathy;
  const f = Math.min(Math.max((y - y0) / dx, 0), ny - 1.001);
  const j = Math.floor(f), t = f - j;
  return shore[j] * (1 - t) + shore[j + 1] * t;
}

// Typical shelf depth at a distance from the beach
export function shelfDepth(dist) {
  return 13 * (Math.max(dist, 0) / 1000) ** 0.75;
}

export function canyonExcess(x, y, h = depth(x, y)) {
  return h - shelfDepth(shorelineX(y) - x);
}

export function wavenumber(period, h) {
  const w = 2 * Math.PI / period;
  h = Math.max(h, 0.05);
  const k0 = w * w / G;
  let k = k0 / Math.tanh((k0 * h) ** 0.75) ** (2 / 3);
  for (let i = 0; i < 2; i++) {
    const th = Math.tanh(k * h);
    const f = G * k * th - w * w;
    const df = G * th + G * k * h * (1 - th * th);
    k -= f / df;
  }
  return k;
}

export function speeds(period, h) {
  h = Math.max(h, 0.05);
  const k = wavenumber(period, h);
  const c = 2 * Math.PI / period / k;
  const kh = Math.min(k * h, 20);
  return [c, c * 0.5 * (1 + 2 * kh / Math.sinh(2 * kh))];
}

export const deepWavelength = (period) => G * period * period / (2 * Math.PI);
export const waveEnergy = (height) => RHO * G * height * height / 8;

export function compass(deg) {
  const names = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
                 "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return names[Math.floor(((deg % 360) + 360) % 360 / 22.5 + 0.5) % 16];
}

// Math angle (radians from +x, anticlockwise) of travel for a swell FROM `direction`
export function travelAngle(direction) {
  const bearing = (direction + 180) * Math.PI / 180;
  return Math.atan2(Math.cos(bearing), Math.sin(bearing));
}

// Northern canyon edge near the head (compass bearing of the edge: 76 deg)
export const EDGE = [[-2000, -1560], [-750, -1120]];
export const EDGE_BEARING = 76;
export const SHELF_DEPTH = 20;          // shelf next to the edge (m)
export const CANYON_DEPTH = 150;        // canyon floor just below the edge (m)

export const PEAK = [-1200, -850];

const ramp = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
const wrap = (deg) => ((deg % 360) + 540) % 360 - 180;

// 0 = swell runs straight into the canyon, 90 = along the edge
export function incidence(direction) {
  const travel = direction - 180;
  const across = EDGE_BEARING + 90;
  return Math.abs(wrap(travel - across));
}

export function criticalAngle(period) {
  const ratio = speeds(period, SHELF_DEPTH)[0] / speeds(period, CANYON_DEPTH)[0];
  return Math.asin(Math.min(ratio, 1)) * 180 / Math.PI;
}

// Share of the swell the edge turns back (0 to 1)
export function reflection(period, direction) {
  const a = incidence(direction), ac = criticalAngle(period);
  const turned = ramp(ac - 10, ac + 5, a);
  const reaches = 1 - ramp(60, 80, a);
  return turned * reaches;
}

export function reflectedBearing(direction) {
  return ((2 * EDGE_BEARING - (direction - 180)) % 360 + 360) % 360;
}

export const LEVELS = [60, 48, 38, 30, 24, 19, 15, 12, 9.5, 7.5, 6, 4.5, 3.5, 2.5];

// Ks = sqrt(cg0 / cg)
export function shoaling(period, h) {
  const cg0 = 0.5 * G * period / (2 * Math.PI);
  return Math.sqrt(cg0 / speeds(period, h)[1]);
}

// [H_b, h_b] from heights at the LEVELS depths
function breakAt(hLevels) {
  for (let i = 0; i < LEVELS.length; i++) {
    const r = hLevels[i] / LEVELS[i];
    if (r >= GAMMA) {
      if (i === 0) return [hLevels[0], LEVELS[0]];
      const r0 = hLevels[i - 1] / LEVELS[i - 1];
      const f = (GAMMA - r0) / Math.max(r - r0, 1e-9);
      const d = LEVELS[i - 1] + f * (LEVELS[i] - LEVELS[i - 1]);
      return [GAMMA * d, d];
    }
  }
  const hb = hLevels[hLevels.length - 1];
  return [hb, hb / GAMMA];
}

export const PLUNGE_PERIOD = 14;

export class Forecast {
  constructor(props) { Object.assign(this, props); }

  wave(hOff = this.h0, canyon = true) {
    const gain = 1 + (canyon ? this.reflected : 0);
    const [hb, db] = breakAt(LEVELS.map((d) => gain * shoaling(this.period, d) * hOff));
    const breaker = this.period >= PLUNGE_PERIOD ? "plunging" : "spilling";
    return { height: hb, depth: db, speed: Math.sqrt(G * (db + hb)), breaker };
  }

  setWave(canyon = true) { return this.wave(SET_FACTOR * this.h0, canyon); }

  get canyonGain() {
    return this.wave().height / Math.max(this.wave(this.h0, false).height, 0.1);
  }
}

export function forecast(period, direction, h0) {
  return new Forecast({
    period, direction, h0,
    reflected: reflection(period, direction),
    incidence: incidence(direction),
    criticalAngle: criticalAngle(period),
    reflectedBearing: reflectedBearing(direction),
  });
}
