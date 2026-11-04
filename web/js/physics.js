// Linear wave physics over the real Nazare bathymetry.
//
//   dispersion relation       w^2 = g k tanh(k h)
//   refraction (ray tracing)  rays bend towards slower, i.e. shallower, water
//   shoaling                  energy flux E * cg is conserved between neighbouring rays
//   depth-limited breaking    H_b = 0.78 h_b
//   breaker type              long swell (14 s and up) plunges, shorter swell spills
//
// Coordinates are metres: x points east (the coast is near x = 0), y points north.
// Depths come from the EMODnet Digital Terrain Model (see tools/build_bathymetry.py).

export const G = 9.81;
export const RHO = 1025;
export const GAMMA = 0.78;
export const SET_FACTOR = 1.8;          // biggest of ~1000 waves in a Rayleigh sea, x Hs

// Depth contours (m) at which height is evaluated on the way to the beach
export const LEVELS = [60, 48, 38, 30, 24, 19, 15, 12, 9.5, 7.5, 6, 4.5, 3.5, 2.5];

export const PRAIA_DO_NORTE = [-700, 3000];   // stretch of coast searched for the peak (y, m)
export const BIN = 100;
export const BINS_Y = Array.from({ length: 121 }, (_, i) => -6000 + i * BIN);

// ------------------------------------------------------------------ bathymetry
//
// Real depths from the EMODnet Digital Terrain Model, packed by tools/build_bathymetry.py
// onto an 80 m grid in the game's frame (metres, x east, y north, lighthouse at -390, -950).

let bathy = null;

export async function loadBathymetry() {
  if (bathy) return bathy;
  const base = new URL("../data/", import.meta.url);
  const version = new URL(import.meta.url).search;      // same "?v=" stamp as this file
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

// Catmull-Rom weights for a smooth (bicubic) sample of the grid
function cubicW(t, out) {
  const t2 = t * t, t3 = t2 * t;
  out[0] = -0.5 * t3 + t2 - 0.5 * t;
  out[1] = 1.5 * t3 - 2.5 * t2 + 1;
  out[2] = -1.5 * t3 + 2 * t2 + 0.5 * t;
  out[3] = 0.5 * t3 - 0.5 * t2;
}
const WX = new Float64Array(4), WY = new Float64Array(4);

// Water depth in metres (negative on land)
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

// Typical shelf off Praia do Norte, fitted to the real profile (about 4 m at 250 m,
// 13 m at 1 km, 22 m at 2 km and 37 m at 4 km from the beach)
export function shelfDepth(dist) {
  return 13 * (Math.max(dist, 0) / 1000) ** 0.75;
}

// How much deeper the water is than that shelf: large inside the canyon
export function canyonExcess(x, y, h = depth(x, y)) {
  return h - shelfDepth(shorelineX(y) - x);
}

// ------------------------------------------------------------ linear wave theory

export function wavenumber(period, h) {
  const w = 2 * Math.PI / period;
  h = Math.max(h, 0.05);
  const k0 = w * w / G;
  let k = k0 / Math.tanh((k0 * h) ** 0.75) ** (2 / 3);     // Fenton and McKee start
  for (let i = 0; i < 2; i++) {                              // then Newton
    const th = Math.tanh(k * h);
    const f = G * k * th - w * w;
    const df = G * th + G * k * h * (1 - th * th);
    k -= f / df;
  }
  return k;
}

// Phase speed c and group speed cg (m/s) at depth h
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

// ------------------------------------------------------------------- the grid

const GX0 = -22000, GX1 = 2500, GY0 = -17000, GY1 = 17000, GDX = 40;
const NX = Math.round((GX1 - GX0) / GDX) + 1;
const NY = Math.round((GY1 - GY0) / GDX) + 1;
const grids = {};

function gradient(f, outX, outY) {
  // central differences inside, one-sided at the edges (like numpy.gradient)
  for (let j = 0; j < NY; j++) {
    for (let i = 0; i < NX; i++) {
      const p = j * NX + i;
      const il = i > 0 ? p - 1 : p, ir = i < NX - 1 ? p + 1 : p;
      const jd = j > 0 ? p - NX : p, ju = j < NY - 1 ? p + NX : p;
      outX[p] = (f[ir] - f[il]) / (((ir - il)) * GDX);
      outY[p] = (f[ju] - f[jd]) / (((ju - jd) / NX) * GDX);
    }
  }
}

// separable Gaussian blur of a grid field, sigma in cells
function blur(f, sigma) {
  const r = Math.ceil(3 * sigma), k = [];
  for (let i = -r; i <= r; i++) k.push(Math.exp(-0.5 * (i / sigma) ** 2));
  const sum = k.reduce((a, b) => a + b, 0);
  const tmp = new Float32Array(f.length);
  for (let j = 0; j < NY; j++) {
    for (let i = 0; i < NX; i++) {
      let v = 0;
      for (let m = -r; m <= r; m++) v += f[j * NX + Math.min(Math.max(i + m, 0), NX - 1)] * k[m + r];
      tmp[j * NX + i] = v / sum;
    }
  }
  for (let j = 0; j < NY; j++) {
    for (let i = 0; i < NX; i++) {
      let v = 0;
      for (let m = -r; m <= r; m++) v += tmp[Math.min(Math.max(j + m, 0), NY - 1) * NX + i] * k[m + r];
      f[j * NX + i] = v / sum;
    }
  }
}

// The real sea floor, or the same coast with the canyon filled in up to the depth of
// the surrounding shelf (for the "without the canyon" comparison).
export function filledDepth(x, y, h = depth(x, y)) {
  return Math.min(h, 1.25 * shelfDepth(shorelineX(y) - x) + 5);
}

function getGrid(canyon) {
  const key = canyon ? "canyon" : "filled";
  if (grids[key]) return grids[key];
  const h = new Float32Array(NX * NY);
  for (let j = 0; j < NY; j++) {
    for (let i = 0; i < NX; i++) {
      const x = GX0 + i * GDX, y = GY0 + j * GDX;
      const v = Math.max(depth(x, y), -2);          // cliffs would bleed into the shallows
      h[j * NX + i] = canyon ? v : filledDepth(x, y, v);
    }
  }
  // Linear refraction sees the sea floor averaged over roughly a wavelength, so features
  // much smaller than that (single rocks, survey noise) are smoothed out before tracing.
  blur(h, 7);
  const hx = new Float32Array(NX * NY), hy = new Float32Array(NX * NY);
  gradient(h, hx, hy);
  grids[key] = { h, hx, hy, c: new Float32Array(NX * NY), cx: new Float32Array(NX * NY),
                 cy: new Float32Array(NX * NY), period: null };
  return grids[key];
}

const inside = (x, y) => x > GX0 && x < GX0 + (NX - 2) * GDX && y > GY0 && y < GY0 + (NY - 2) * GDX;

// Bilinear sample of several fields at once
function sample(fields, x, y, out) {
  const fx = (x - GX0) / GDX, fy = (y - GY0) / GDX;
  const i = Math.min(Math.max(Math.floor(fx), 0), NX - 2);
  const j = Math.min(Math.max(Math.floor(fy), 0), NY - 2);
  const tx = Math.min(Math.max(fx - i, 0), 1), ty = Math.min(Math.max(fy - j, 0), 1);
  const p = j * NX + i;
  const a = (1 - tx) * (1 - ty), b = tx * (1 - ty), c = (1 - tx) * ty, d = tx * ty;
  for (let k = 0; k < fields.length; k++) {
    const f = fields[k];
    out[k] = f[p] * a + f[p + 1] * b + f[p + NX] * c + f[p + NX + 1] * d;
  }
  return out;
}

// ------------------------------------------------------------------- forecast

// Breaking height from heights at the LEVELS depths (deep to shallow): [H_b, h_b]
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

// Breaker type. The real bottom slope where the big waves break off Praia do Norte is
// gentle (1 to 2 %), so by the Iribarren number alone every wave would spill. Nazare's
// big waves pitch because long-period swell arrives steep and focused (crossing crests),
// so the game uses a simple rule instead: long swell plunges and can barrel.
export const PLUNGE_PERIOD = 14;

// distance from the shore at which the real sea floor at latitude y reaches depth d
function distanceToDepth(d, y) {
  const xs = shorelineX(y);
  let dist = 0;
  while (dist < 20000 && depth(xs - dist, y) < d) dist += 20;
  return dist;
}

function smooth(a, sigma = 1.5) {
  const r = Math.floor(3 * sigma);
  const k = [];
  for (let i = -r; i <= r; i++) k.push(Math.exp(-0.5 * (i / sigma) ** 2));
  const sum = k.reduce((s, v) => s + v, 0);
  return a.map((_, i) => {
    let s = 0;
    for (let m = -r; m <= r; m++) if (i + m >= 0 && i + m < a.length) s += a[i + m] * k[m + r];
    return s / sum;
  });
}

export class Forecast {
  constructor(props) { Object.assign(this, props); }

  get wavelength0() { return deepWavelength(this.period); }

  // Breaking wave at the peak for an offshore height hOff (default Hs)
  wave(hOff = this.h0, canyon = true) {
    const amp = canyon ? this.amp : this.plainAmp;
    const [hb, db] = breakAt(amp.map((a) => a * hOff));
    // Iribarren number on the real slope, kept for reference (see PLUNGE_PERIOD)
    const tanBeta = db / Math.max(distanceToDepth(db, this.peakY), 1);
    const xi = tanBeta / Math.sqrt(hOff / this.wavelength0);
    const breaker = this.period >= PLUNGE_PERIOD ? "plunging" : "spilling";
    return { height: hb, depth: db, speed: Math.sqrt(G * (db + hb)), iribarren: xi, breaker };
  }

  setWave(canyon = true) { return this.wave(SET_FACTOR * this.h0, canyon); }

  get canyonGain() {
    return this.wave().height / Math.max(this.wave(this.h0, false).height, 0.1);
  }
}

// Trace swell rays over one sea floor. Returns the drawn ray paths and, for every
// LEVELS depth, the amplification H / H0 in each 100 m bin along the coast.
function trace(gr, period, direction, nRays, nDraw, ds) {
  if (gr.period !== period) {
    const w = 2 * Math.PI / period;
    for (let p = 0; p < gr.h.length; p++) gr.c[p] = w / wavenumber(period, gr.h[p]);
    gradient(gr.c, gr.cx, gr.cy);
    gr.period = period;
  }
  const fields = [gr.c, gr.cx, gr.cy, gr.h];
  const gfields = [gr.hx, gr.hy];

  const th0 = travelAngle(direction);
  const ux = Math.cos(th0), uy = Math.sin(th0);
  const sx = 0 - 15000 * ux, sy = 800 - 15000 * uy;
  const width = 20000, spacing = width / nRays;
  const x = new Float64Array(nRays), y = new Float64Array(nRays);
  const th = new Float64Array(nRays).fill(th0), t = new Float64Array(nRays);
  const here = Array.from({ length: nRays }, () => new Float64Array(4));
  const active = new Uint8Array(nRays);
  for (let r = 0; r < nRays; r++) {
    const off = (r + 0.5) * spacing - width / 2;
    x[r] = sx - uy * off;
    y[r] = sy + ux * off;
    sample(fields, x[r], y[r], here[r]);
    active[r] = inside(x[r], y[r]) && here[r][3] > 1.5 ? 1 : 0;
  }
  const nl = LEVELS.length;
  const crossY = Array.from({ length: nl }, () => new Float64Array(nRays).fill(NaN));
  const crossW = Array.from({ length: nl }, () => new Float64Array(nRays));

  const drawEvery = (nRays - 1) / Math.max(nDraw - 1, 1);
  const drawOf = new Int32Array(nRays).fill(-1);
  const paths = [];
  for (let k = 0; k < nDraw; k++) {
    const ri = Math.floor(k * drawEvery);
    drawOf[ri] = k;
    paths.push([[x[ri], y[ri], 0]]);
  }

  const g = new Float64Array(2);
  for (let step = 0; step < 24000 / ds; step++) {
    let any = false;
    for (let r = 0; r < nRays; r++) {
      if (!active[r]) continue;
      any = true;
      const hr = here[r];
      const c = hr[0], gx = hr[1], gy = hr[2], hp = hr[3];
      // ray curvature: d(theta)/ds = (sin(theta) dc/dx - cos(theta) dc/dy) / c
      const ta = th[r] + (Math.sin(th[r]) * gx - Math.cos(th[r]) * gy) / c * ds;
      th[r] = ta;
      x[r] += Math.cos(ta) * ds;
      y[r] += Math.sin(ta) * ds;
      t[r] += ds / c;
      sample(fields, x[r], y[r], hr);
      const hNew = hr[3];
      if (hp < LEVELS[0] + 1) {
        let gotG = false, weight = 0;
        for (let li = 0; li < nl; li++) {
          if (hp > LEVELS[li] && hNew <= LEVELS[li]) {
            if (!gotG) {
              sample(gfields, x[r], y[r], g);
              const gn = Math.hypot(g[0], g[1]) + 1e-9;
              const nx = -g[0] / gn, ny = -g[1] / gn;
              const cosA = Math.max(Math.cos(ta) * nx + Math.sin(ta) * ny, 0.25);
              weight = Math.abs(nx) / cosA;
              gotG = true;
            }
            crossY[li][r] = y[r];
            crossW[li][r] = weight;
          }
        }
      }
      const done = hNew < 1.5 || !inside(x[r], y[r]);
      if (drawOf[r] >= 0 && (step % 4 === 3 || done)) paths[drawOf[r]].push([x[r], y[r], t[r]]);
      if (done) active[r] = 0;
    }
    if (!any) break;
  }

  // Energy flux between rays: H / H0 = sqrt(n * spacing / (bin * cos)) * sqrt(cg0 / cg)
  const cg0 = 0.5 * G * period / (2 * Math.PI);
  const nb = BINS_Y.length;
  const amp = [];
  for (let li = 0; li < nl; li++) {
    const flux = new Array(nb).fill(0);
    for (let r = 0; r < nRays; r++) {
      const yy = crossY[li][r];
      if (Number.isNaN(yy)) continue;
      const b = Math.floor((yy - (BINS_Y[0] - BIN / 2)) / BIN);
      if (b >= 0 && b < nb) flux[b] += crossW[li][r];
    }
    const kr2 = smooth(flux.map((f) => f * spacing / BIN)).map((v) => Math.min(v, 9));
    const cgl = speeds(period, LEVELS[li])[1];
    amp.push(kr2.map((v) => Math.sqrt(v) * Math.sqrt(cg0 / cgl)));
  }
  return { paths, amp };
}

// Wave heights along the coast for a swell, over the real sea floor and over the same
// coast without the canyon. The peak is the biggest breaking wave on Praia do Norte.
export function forecast(period, direction, h0, nRays = 1200, nDraw = 110, ds = 20) {
  const real = trace(getGrid(true), period, direction, nRays, nDraw, ds);
  const filled = trace(getGrid(false), period, direction, nRays, 0, ds);
  const ampAt = (amp, b) => amp.map((row) => row[b]);
  const hbProfile = BINS_Y.map((_, b) => breakAt(ampAt(real.amp, b).map((a) => a * h0))[0]);
  let peak = -1;
  BINS_Y.forEach((yb, b) => {
    if (yb >= PRAIA_DO_NORTE[0] && yb <= PRAIA_DO_NORTE[1] &&
        (peak < 0 || hbProfile[b] > hbProfile[peak])) peak = b;
  });

  return new Forecast({
    period, direction, h0,
    rays: real.paths.filter((p) => p.length > 2),
    hbProfile, peakY: BINS_Y[peak],
    amp: ampAt(real.amp, peak), plainAmp: ampAt(filled.amp, peak),
  });
}
