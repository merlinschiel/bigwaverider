// Swell map: depths, landmarks, the swell arrow and, once locked in, the wave crests.

import { PEAK, canyonExcess, compass, depth, shorelineX, travelAngle } from "./physics.js";
import { CrestField } from "./crests.js";

const CENTER = [-2000, 300];
const SPAN = [9000, 8600];            // always visible (m)
const CREST_SPEEDUP = 20;
const DEPTH_TICKS = [5, 20, 50, 100, 200, 500];

const LIGHTHOUSE = [-390, -950];
const PRAIA_NORTE_Y = 1000;
const PRAIA_NAZARE_Y = -2050;
const CANYON_LABEL = [-3300, -2080];
const CANYON_ANGLE = 0.06;
const STEEP = [0.07, 0.3];            // bottom slope shaded as steep

const RING_R = 4200;
const DIR_MIN = 240, DIR_MAX = 340, DIR_STEP = 5;
const TICKS = [[247.5, "WSW"], [270, "W"], [292.5, "WNW"], [315, "NW"], [337.5, "NNW"]];

const WATER = [[0, [143, 240, 220]], [0.3, [47, 184, 196]], [0.62, [19, 96, 143]], [1, [7, 26, 56]]];
const TURNED = [158, 235, 255];
const CREST_PX = 4;

function ramp(stops, t) {
  t = Math.min(Math.max(t, 0), 1);
  for (let i = 1; i < stops.length; i++) {
    const [p1, c1] = stops[i];
    if (t <= p1) {
      const [p0, c0] = stops[i - 1];
      const f = (t - p0) / (p1 - p0);
      return c0.map((v, k) => v + (c1[k] - v) * f);
    }
  }
  return stops[stops.length - 1][1];
}

const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const depthT = (h) => Math.min(Math.max(Math.log10(Math.max(h, 1)) / 3, 0), 1);
const mix = (a, b, t) => a.map((v, k) => v + (b[k] - v) * t);
const smooth = (e0, e1, x) => { const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1); return t * t * (3 - 2 * t); };

export class SwellMap {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.forecast = null;
    this.swell = { period: 18, dir: 300, size: 7 };
    this.interactive = true;
    this.onDirection = null;
    this.anim = 0;
    this.time = 0;
    this.bathy = null;
    this.size = [0, 0];
    this.dragging = false;
    this.hover = false;
    this.layer = document.createElement("canvas");
    this.mask = document.createElement("canvas");
    this.crests = null;
    this.bindPointer();
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (w === this.size[0] && h === this.size[1]) return;
    this.size = [w, h];
    this.dpr = dpr;
    this.canvas.width = this.layer.width = this.mask.width = w * dpr;
    this.canvas.height = this.layer.height = this.mask.height = h * dpr;
    this.scale = Math.min(w / SPAN[0], h / SPAN[1]);
    this.renderBathymetry();
    this.renderMask();
    if (this.crests) this.crests.view = null;
  }

  toScreen(x, y) {
    const [w, h] = this.size;
    return [w / 2 + (x - CENTER[0]) * this.scale, h / 2 - (y - CENTER[1]) * this.scale];
  }

  toWorld(px, py) {
    const [w, h] = this.size;
    return [CENTER[0] + (px - w / 2) / this.scale, CENTER[1] - (py - h / 2) / this.scale];
  }

  renderBathymetry() {
    const [w, h] = this.size;
    const res = 1.25;
    const W = Math.round(w * res), H = Math.round(h * res);
    const metresPerPx = 1 / (this.scale * res);
    const off = document.createElement("canvas");
    off.width = W; off.height = H;
    const octx = off.getContext("2d");
    const img = octx.createImageData(W, H);
    const d = new Float32Array(W * H);
    const inCanyon = new Uint8Array(W * H);
    const beachX = new Float32Array(W * H);
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const [x, y] = this.toWorld((i + 0.5) / res, (j + 0.5) / res);
        const v = x > shorelineX(y) + 250 ? Math.min(depth(x, y), -1) : depth(x, y);
        d[j * W + i] = v;
        beachX[j * W + i] = x - shorelineX(y);
        inCanyon[j * W + i] = v > 30 && canyonExcess(x, y, v) > 30 ? 1 : 0;
      }
    }
    const level = (v) => { let k = 0; while (k < DEPTH_TICKS.length && v > DEPTH_TICKS[k]) k++; return k; };
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const p = j * W + i, v = d[p];
        const vr = d[p + (i < W - 1 ? 1 : 0)], vd = d[p + (j < H - 1 ? W : 0)];
        let c;
        if (v <= 0) {
          const e = -v;
          const relief = Math.max(-0.35, Math.min(0.35, ((vr - v) - (vd - v)) / metresPerPx * 4));
          c = mix([28, 37, 50], [62, 72, 84], Math.min(e / 120, 1)).map((q) => q * (1 + relief));
          if (e < 4 && beachX[p] < 160) c = [232, 212, 160];
        } else {
          c = ramp(WATER, depthT(v));
          const shade = Math.max(-0.25, Math.min(0.25, (Math.log10(Math.max(vr, 1)) - Math.log10(Math.max(v, 1))) * 6
                                                      - (Math.log10(Math.max(vd, 1)) - Math.log10(Math.max(v, 1))) * 6));
          c = c.map((q) => q * (1 + shade));
          if (inCanyon[p]) c = mix(c, [10, 30, 90], 0.25);
          if (vr > 0 && vd > 0 && (level(vr) !== level(v) || level(vd) !== level(v))) {
            c = c.map((q) => q * 0.8 + 255 * 0.2 * 0.6);
          }
          const slope = Math.hypot(vr - v, vd - v) / metresPerPx;
          const t = smooth(STEEP[0], STEEP[1], slope);
          if (t > 0) c = mix(c, [196, 255, 120], 0.55 * t);
        }
        img.data[p * 4] = c[0]; img.data[p * 4 + 1] = c[1]; img.data[p * 4 + 2] = c[2];
        img.data[p * 4 + 3] = 255;
      }
    }
    octx.putImageData(img, 0, 0);
    this.bathy = off;
  }

  renderMask() {
    this.buildMask((x, y) => smooth(1300, 2900, shorelineX(y) - x), this.mask);
  }

  // alpha(x, y) mask at quarter resolution
  buildMask(alpha, out = document.createElement("canvas")) {
    const [w, h] = this.size;
    const W = Math.ceil(w / 4), H = Math.ceil(h / 4);
    const small = document.createElement("canvas");
    small.width = W; small.height = H;
    const sctx = small.getContext("2d");
    const img = sctx.createImageData(W, H);
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const [x, y] = this.toWorld((i + 0.5) * 4, (j + 0.5) * 4);
        img.data[(j * W + i) * 4 + 3] = alpha(x, y) * 255;
      }
    }
    sctx.putImageData(img, 0, 0);
    out.width = w * this.dpr;
    out.height = h * this.dpr;
    const mctx = out.getContext("2d");
    mctx.imageSmoothingQuality = "high";
    mctx.drawImage(small, 0, 0, out.width, out.height);
    return out;
  }

  setForecast(fc) {
    if (fc !== this.forecast) this.crests = fc ? new CrestField(fc) : null;
    this.forecast = fc;
  }

  draw(dt) {
    this.resize();
    const ctx = this.ctx;
    const [w, h] = this.size;
    this.anim += dt * CREST_SPEEDUP;
    this.time += dt;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(this.bathy, 0, 0, w, h);
    if (this.forecast) {
      this.drawSchematic();
    } else {
      this.drawIncoming();
    }
    this.drawLandmarks();
    this.drawRing();
    if (this.forecast) this.drawPeak();
  }

  drawIncoming() {
    const { period, dir, size } = this.swell;
    const [w, h] = this.size;
    const lctx = this.layer.getContext("2d");
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.globalCompositeOperation = "source-over";
    lctx.clearRect(0, 0, this.layer.width, this.layer.height);
    lctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const th = travelAngle(dir);
    const ux = Math.cos(th), uy = -Math.sin(th);
    const spacing = 16 + (period - 6) * 3;
    const diag = Math.hypot(w, h);
    const phase = (this.time * spacing * 0.6) % spacing;
    const path = new Path2D();
    for (let s = -diag / 2 - spacing + phase; s < diag / 2 + spacing; s += spacing) {
      const cx = w / 2 + ux * s, cy = h / 2 + uy * s;
      path.moveTo(cx + uy * diag, cy - ux * diag);
      path.lineTo(cx - uy * diag, cy + ux * diag);
    }
    lctx.lineCap = "round";
    lctx.strokeStyle = "rgba(255,255,255,0.12)";
    lctx.lineWidth = 5 + size * 0.5;
    lctx.stroke(path);
    lctx.strokeStyle = `rgba(255,255,255,${0.45 + size * 0.04})`;
    lctx.lineWidth = 1.1 + size * 0.2;
    lctx.stroke(path);

    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.globalCompositeOperation = "destination-in";
    lctx.drawImage(this.mask, 0, 0);
    this.ctx.drawImage(this.layer, 0, 0, w, h);
  }

  drawSchematic() {
    const fc = this.forecast, cf = this.crests, ctx = this.ctx;
    if (!cf.view) {
      const [w, h] = this.size;
      const [xa, yb] = this.toWorld(-20, -20), [xb, ya] = this.toWorld(w + 20, h + 20);
      cf.setView(xa, xb, ya, yb, Math.max(30, CREST_PX / this.scale));
    }
    const phase = this.anim % fc.period;
    const s = this.scale, [w, h] = this.size;
    const sx = (x) => w / 2 + (x - CENTER[0]) * s, sy = (y) => h / 2 - (y - CENTER[1]) * s;
    const groups = new Map();
    cf.contours("T", phase, (x0, y0, x1, y1, e) => {
      const key = Math.round(Math.min(Math.max(e, 0), 2.6) * 10);
      let path = groups.get(key);
      if (!path) groups.set(key, path = new Path2D());
      path.moveTo(sx(x0), sy(y0));
      path.lineTo(sx(x1), sy(y1));
    });
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const [key, path] of groups) {
      const e = key / 10;
      const alpha = Math.min(Math.max(0.6 * e ** 1.5, 0.08), 1);
      const width = Math.min(Math.max(1.2 + 0.5 * e, 1.2), 2.6);
      ctx.strokeStyle = `rgba(255,255,255,${0.25 * alpha})`;
      ctx.lineWidth = width * 3.2;
      ctx.stroke(path);
      ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
      ctx.lineWidth = width;
      ctx.stroke(path);
    }
    if (cf.mirror && fc.reflected > 0.03) {
      const path = new Path2D();
      cf.contours("R", phase, (x0, y0, x1, y1) => {
        path.moveTo(sx(x0), sy(y0));
        path.lineTo(sx(x1), sy(y1));
      });
      const a = Math.min(1, 0.25 + fc.reflected);
      ctx.strokeStyle = rgb(TURNED, 0.25 * a);
      ctx.lineWidth = 5.5;
      ctx.stroke(path);
      ctx.strokeStyle = rgb(TURNED, 0.95 * a);
      ctx.lineWidth = 1.8;
      ctx.stroke(path);
    }
  }

  drawPeak() {
    const fc = this.forecast, ctx = this.ctx;
    const peak = (fc.reflected >= 0.3 && this.crests?.peak) || PEAK;
    const [px, py] = this.toScreen(peak[0], peak[1]);
    const pulse = (this.anim / CREST_SPEEDUP) % 1.6 / 1.6;
    ctx.strokeStyle = `rgba(255,255,255,${0.8 * (1 - pulse)})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(px, py, 10 + 22 * pulse, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI * 2); ctx.fill();
    this.sidePill(`Peak ${fc.setWave().height.toFixed(0)} m`, px, py, 18, "left");
  }

  get small() { return this.size[0] < 560; }

  drawLandmarks() {
    const ctx = this.ctx, sm = this.small;
    this.label("NAZARÉ CANYON", CANYON_LABEL[0], CANYON_LABEL[1], { rotate: CANYON_ANGLE, align: "center",
      spacing: sm ? "3px" : "5px", font: `800 ${sm ? 12 : 15}px Inter, sans-serif`, color: "rgba(200,244,255,0.95)", shadow: true });
    this.label("underwater valley, up to 5 km deep", CANYON_LABEL[0], CANYON_LABEL[1] - (sm ? 420 : 330), {
      rotate: CANYON_ANGLE, align: "center", font: `500 ${sm ? 10 : 12}px Inter, sans-serif`,
      color: "rgba(200,244,255,0.8)", shadow: true });
    this.label("NAZARÉ", 1500, -1900, { spacing: "3px", font: "700 12px Inter, sans-serif", color: "rgba(230,240,248,0.7)" });

    this.beach("Praia do Norte", [shorelineX(PRAIA_NORTE_Y), PRAIA_NORTE_Y], "left");
    this.beach("Praia da Nazaré", [shorelineX(PRAIA_NAZARE_Y), PRAIA_NAZARE_Y], "right");
    this.lighthouse();

    const [bx, by] = this.toScreen(1000, 3900);
    ctx.strokeStyle = "rgba(230,240,248,0.7)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + 1000 * this.scale, by); ctx.stroke();
    this.label("1 km", 1500, 4050, { align: "center", font: "600 11px Inter, sans-serif" });

    const [w, h] = this.size;
    ctx.font = "500 10px Inter, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "rgba(230,240,248,0.55)";
    ctx.fillText(sm ? "Depths: EMODnet" : "Depths: EMODnet Bathymetry (CC BY 4.0)", w - 8, h - 8);
  }

  beach(name, at, side) {
    const ctx = this.ctx;
    const [x, y] = this.toScreen(at[0], at[1]);
    ctx.fillStyle = "#f3dfa8";
    ctx.strokeStyle = "rgba(6,20,35,0.9)";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    this.sidePill(name, x, y, 12, side);
  }

  sidePill(text, x, y, gap, side) {
    const w = this.pillWidth(text);
    if (side === "right" && x + gap + w > this.size[0] - 4) side = "left";
    if (side === "left" && x - gap - w < 4) side = "right";
    this.pill(text, side === "right" ? x + gap : x - gap, y, "#fff", "rgba(6,20,35,0.82)", side === "left");
  }

  lighthouse() {
    const ctx = this.ctx;
    const [x, y] = this.toScreen(LIGHTHOUSE[0], LIGHTHOUSE[1]);
    const a = this.time * 0.9;
    const len = Math.min(110, 1800 * this.scale);
    const g = ctx.createRadialGradient(x, y - 14, 0, x, y - 14, len);
    g.addColorStop(0, "rgba(255,236,170,0.5)");
    g.addColorStop(1, "rgba(255,236,170,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x, y - 14);
    ctx.arc(x, y - 14, len, a - 0.22, a + 0.22);
    ctx.closePath();
    ctx.fill();
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = 6;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.moveTo(x - 6, y + 4); ctx.lineTo(x + 6, y + 4); ctx.lineTo(x + 3.5, y - 12); ctx.lineTo(x - 3.5, y - 12);
    ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.fillStyle = "#e5484d";
    ctx.fillRect(x - 4.6, y - 6, 9.2, 4);
    ctx.fillStyle = "#ffe58a";
    ctx.beginPath(); ctx.arc(x, y - 15, 3.4, 0, Math.PI * 2); ctx.fill();
    this.sidePill("Nazaré Lighthouse", x, y - 4, 14, "right");
  }

  ringPoint(bearing, extra = 0) {
    const b = bearing * Math.PI / 180;
    const [cx, cy] = this.toScreen(LIGHTHOUSE[0], LIGHTHOUSE[1]);
    const r = RING_R * this.scale + extra;
    return [cx + r * Math.sin(b), cy - r * Math.cos(b)];
  }

  drawRing() {
    const ctx = this.ctx;
    const [cx, cy] = this.toScreen(LIGHTHOUSE[0], LIGHTHOUSE[1]);
    const r = RING_R * this.scale;
    const arc = (b0, b1) => { ctx.beginPath(); ctx.arc(cx, cy, r, (b0 - 90) * Math.PI / 180, (b1 - 90) * Math.PI / 180); };
    const live = this.interactive;

    ctx.save();
    ctx.lineCap = "round";
    if (live) {
      ctx.strokeStyle = "rgba(255,255,255,0.10)";
      ctx.lineWidth = 16;
      arc(DIR_MIN, DIR_MAX); ctx.stroke();
    }
    ctx.strokeStyle = `rgba(255,255,255,${live ? 0.55 : 0.3})`;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([2, 5]);
    arc(DIR_MIN - 8, DIR_MAX + 8); ctx.stroke();
    ctx.setLineDash([]);
    for (const [b, name] of TICKS) {
      if (Math.abs(b - this.swell.dir) < 11) continue;
      const [x0, y0] = this.ringPoint(b, -5), [x1, y1] = this.ringPoint(b, 5);
      ctx.strokeStyle = "rgba(255,255,255,0.6)";
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      const [lx, ly] = this.ringPoint(b, 20);
      ctx.font = "700 11px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(230,240,248,0.8)";
      ctx.fillText(name, lx, ly);
    }

    const dir = this.swell.dir;
    const [kx, ky] = this.ringPoint(dir);
    const ang = Math.atan2(cy - ky, cx - kx);
    const tip = [kx + Math.cos(ang) * 74, ky + Math.sin(ang) * 74];
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = 10;
    ctx.strokeStyle = "#ff7a59";
    ctx.fillStyle = "#ff7a59";
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(kx, ky); ctx.lineTo(tip[0] - 10 * Math.cos(ang), tip[1] - 10 * Math.sin(ang)); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(tip[0] + 6 * Math.cos(ang), tip[1] + 6 * Math.sin(ang));
    ctx.lineTo(tip[0] - 16 * Math.cos(ang - 0.5), tip[1] - 16 * Math.sin(ang - 0.5));
    ctx.lineTo(tip[0] - 16 * Math.cos(ang + 0.5), tip[1] - 16 * Math.sin(ang + 0.5));
    ctx.closePath(); ctx.fill();
    if (live) {
      const pulse = (this.time % 1.8) / 1.8;
      ctx.shadowBlur = 0;
      ctx.strokeStyle = `rgba(255,122,89,${0.7 * (1 - pulse)})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(kx, ky, 15 + 14 * pulse, 0, Math.PI * 2); ctx.stroke();
      ctx.shadowBlur = 10;
    }
    ctx.fillStyle = "#ff7a59";
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 3;
    const kr = this.dragging || this.hover ? 15 : 13;
    ctx.beginPath(); ctx.arc(kx, ky, kr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.restore();

    const [px, py] = this.ringPoint(dir, 30);
    const text = `Swell from ${compass(dir)}`;
    const tw = this.pillWidth(text);
    this.pill(text, Math.max(8, px - tw / 2), py, "#10131a", "#ff7a59");
  }

  bindPointer() {
    const c = this.canvas;
    const local = (e) => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const bearingAt = ([px, py]) => {
      const [cx, cy] = this.toScreen(LIGHTHOUSE[0], LIGHTHOUSE[1]);
      return ((Math.atan2(px - cx, cy - py) * 180 / Math.PI) + 360) % 360;
    };
    const onRing = (p) => {
      const [cx, cy] = this.toScreen(LIGHTHOUSE[0], LIGHTHOUSE[1]);
      const [kx, ky] = this.ringPoint(this.swell.dir);
      if (Math.hypot(p[0] - kx, p[1] - ky) < 30) return true;
      const b = bearingAt(p);
      return Math.abs(Math.hypot(p[0] - cx, p[1] - cy) - RING_R * this.scale) < 30 && b > DIR_MIN - 15 && b < DIR_MAX + 15;
    };
    const set = (p) => {
      const b = Math.min(Math.max(bearingAt(p), DIR_MIN), DIR_MAX);
      const d = Math.round(b / DIR_STEP) * DIR_STEP;
      if (d !== this.swell.dir && this.onDirection) this.onDirection(d);
    };
    c.addEventListener("pointerdown", (e) => {
      if (!this.interactive) return;
      const p = local(e);
      if (!onRing(p)) return;
      this.dragging = true;
      c.setPointerCapture(e.pointerId);
      set(p);
      e.preventDefault();
    });
    c.addEventListener("pointermove", (e) => {
      const p = local(e);
      if (this.dragging) return set(p);
      this.hover = this.interactive && onRing(p);
      c.style.cursor = this.hover ? "grab" : "";
    });
    const end = () => { this.dragging = false; };
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
  }

  get pillFont() { return this.small ? "700 11px Inter, sans-serif" : "700 13px Inter, sans-serif"; }

  pillWidth(text) {
    this.ctx.font = this.pillFont;
    return this.ctx.measureText(text).width + (this.small ? 14 : 18);
  }

  pill(text, x, y, fg, bg, alignRight = false) {
    const ctx = this.ctx, sm = this.small;
    const w = this.pillWidth(text), hh = sm ? 10 : 13;
    if (alignRight) x -= w;
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.roundRect(x, y - hh, w, 2 * hh, hh); ctx.fill();
    ctx.fillStyle = fg;
    ctx.font = this.pillFont;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x + (sm ? 7 : 9), y + 1);
  }

  label(text, x, y, opts = {}) {
    const ctx = this.ctx;
    const [sx, sy] = this.toScreen(x, y);
    ctx.save();
    ctx.translate(sx, sy);
    if (opts.rotate) ctx.rotate(opts.rotate);
    ctx.font = opts.font || "600 12px Inter, sans-serif";
    ctx.textAlign = opts.align || "left";
    ctx.textBaseline = "middle";
    if (opts.spacing) ctx.letterSpacing = opts.spacing;
    if (opts.shadow) { ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 6; }
    ctx.fillStyle = opts.color || "rgba(230,240,248,0.85)";
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }
}
