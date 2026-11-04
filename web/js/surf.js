// Surf the wave the swell produced: tow-in, ride the face, barrels and airs.
//
// The wave is seen from the beach. x runs along the crest (metres, the breaking curl
// chases you from the left), u is height up the face (0 = trough, H = lip). Height,
// speed and shape (plunging or spilling) come from the physics.

const RIDE_TIME = 25;
const TOW_TIME = 2.6;
const TURN_RATE = 150;          // deg/s carving
const MAX_HEADING = 70;
const FACE_GRAVITY = 6;         // g sin(face angle) on a ~38 deg face, m/s^2
const AIR_KICK = 0.6;           // share of up-face speed that becomes take-off speed
const AIR_GRAVITY = 0.85 * 9.81;
const SPIN_RATE = 420;
const POCKET_RATE = 40;         // points per second close to the curl
const PUMP = 4;
const BRAKE = 6;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const rad = (d) => d * Math.PI / 180;

const POSES = {
  //       back foot, back knee, front foot, front knee, hips, shoulders, head,
  //       back elbow, back hand, front elbow, front hand   (metres, up positive)
  stand: [[-0.42, 0.05], [-0.32, 0.45], [0.42, 0.05], [0.36, 0.44], [0, 0.86], [0.1, 1.38],
          [0.16, 1.62], [-0.34, 1.3], [-0.64, 1.18], [0.42, 1.28], [0.74, 1.06]],
  crouch: [[-0.42, 0.05], [-0.42, 0.4], [0.42, 0.05], [0.5, 0.42], [-0.02, 0.6], [0.28, 1.0],
           [0.42, 1.2], [-0.18, 0.92], [-0.46, 0.8], [0.55, 0.9], [0.78, 0.7]],
  fall: [[-0.42, 0.05], [-0.5, 0.45], [0.42, 0.05], [0.2, 0.5], [0, 0.86], [-0.1, 1.38],
         [-0.12, 1.62], [-0.3, 1.7], [-0.4, 2.0], [0.3, 1.7], [0.5, 2.0]],
};

let foamSprite = null, cloudSprites = null;

function softDot(size, color) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, color(1));
  grad.addColorStop(0.55, color(0.9));
  grad.addColorStop(1, color(0));
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

function makeCloud(seed) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const c = document.createElement("canvas");
  c.width = 520; c.height = 170;
  const g = c.getContext("2d");
  g.filter = "blur(8px)";
  for (let i = 0; i < 10; i++) {
    const w = 120 + rnd() * 180, h = 40 + rnd() * 50;
    const x = 30 + rnd() * (520 - w - 60), y = 130 - h - rnd() * 40;
    g.fillStyle = `rgba(255,${226 + rnd() * 20 | 0},${214 + rnd() * 20 | 0},${0.35 + rnd() * 0.3})`;
    g.beginPath(); g.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); g.fill();
  }
  return c;
}

export class SurfGame {
  constructor(wave, { index = 0, demo = false, seed = Math.random() } = {}) {
    if (!foamSprite) {
      foamSprite = softDot(64, (a) => `rgba(255,255,255,${a})`);
      cloudSprites = [makeCloud(7), makeCloud(19), makeCloud(41)];
    }
    this.wave = wave;
    this.index = index;
    this.demo = demo;
    this.H = Math.max(wave.height, 1.2);
    this.c = wave.speed;
    this.plunging = wave.breaker !== "spilling";
    this.ppm = clamp(430 / this.H, 14, 46);
    this.vp = 0.6 * this.c;                    // speed the curl peels along the crest
    this.s0 = 0.92 * this.vp;
    this.smin = 0.3 * this.vp;
    this.smax = 1.5 * this.vp;
    this.lc = (this.plunging ? 0.9 : 0.3) * this.H;
    this.mult = Math.max(1, Math.round(this.H / 4 * 10) / 10);
    this.phases = [seed * 6.3, (seed * 7.7) % 6.3];

    this.t = 0;
    this.rideT = 0;
    this.state = demo ? "ride" : "tow";
    this.stateT = 0;
    this.xc = 0;
    this.x = this.lc + 4 + 0.4 * this.H;
    this.u = 0.35 * this.H;
    this.a = 0;
    this.s = 1.05 * this.vp;
    this.vx = this.vu = this.spin = 0;
    this.tumble = 0;
    this.jet = demo ? null : [this.x + 5.5, this.u];

    this.points = 0;
    this.tricks = [];
    this.tubeT = 0;
    this.pocket = 0;
    this.armedTop = this.armedBottom = false;
    this.popups = [];
    this.completed = false;
    this.reason = "";
    this.banked = 0;
    this.result = null;

    this.view = { w: 1280, h: 720 };
    this.cam = this.x - 0.42 * 1280 / this.ppm;
    this.streaks = [];
    this.foam = [];
    this.spray = [];
    this.clouds = [0, 1, 2, 3, 4].map((i) => ({
      x: (i * 0.23 + 0.05) * 1600, y: 0.12 + 0.13 * (i % 3), k: i % 3, speed: 4 + i * 1.5,
      scale: 0.7 + 0.15 * (i % 3) }));
  }

  // ------------------------------------------------------------ geometry

  get trough() { return this.view.h - 110; }
  get lipY() { return this.trough - this.H * this.ppm; }
  sx(x) { return (x - this.cam) * this.ppm; }
  sy(u) { return this.trough - u * this.ppm; }

  get lipZone() { return this.plunging && this.xc < this.x && this.x < this.xc + this.lc; }

  pileTop(x) {
    const rel = Math.min((x - this.xc) / Math.max(this.H, 1), 0);
    const u = this.H * (0.72 + 0.28 * Math.exp(rel * 1.2));
    return u + 0.04 * this.H * Math.sin(0.9 * x + 3 * this.t) + 0.03 * this.H * Math.sin(2.3 * x);
  }

  popup(text, color = "#ffffff") {
    if (!this.demo) this.popups.push({ text, life: 1.6, color, rise: 0 });
  }

  award(name, pts) {
    pts = Math.round(pts);
    this.points += pts;
    this.tricks.push([name, pts]);
    this.popup(`${name} +${pts}`, "#ffc857");
  }

  // ------------------------------------------------------------ input

  release() {
    if (this.state !== "tow") return;
    this.state = "ride";
    this.stateT = 0;
    this.a = -15;
    this.popup("Go!", "#4fe3d0");
  }

  // ------------------------------------------------------------ update

  update(dt, keys) {
    if (this.demo) keys = this.autopilot();
    this.t += dt;
    this.stateT += dt;
    const [p1, p2] = this.phases;
    const surge = 1 + 0.15 * Math.sin(0.5 * this.t + p1) + 0.07 * Math.sin(1.3 * this.t + p2);
    if (this.state !== "over") this.xc += this.vp * (this.state === "tow" ? 1 : surge) * dt;

    if (this.state === "tow") {
      this.x += 1.08 * this.vp * dt;
      this.u += (0.35 * this.H - this.u) * dt;
      this.jet = [this.x + 5.5, this.u - 0.15];
      if (this.stateT > TOW_TIME) this.release();
    } else if (this.state === "ride") {
      this.rideT += dt;
      this.updateRide(dt, keys);
    } else if (this.state === "air") {
      this.rideT += dt;
      this.updateAir(dt, keys);
    } else if (this.state === "wipeout") {
      this.x = Math.min(this.x, this.xc - 1);
      this.u = Math.max(0, this.u - 0.6 * this.H * dt);
      this.tumble += 620 * dt;
      if (this.stateT > 1.6) this.finish();
    }

    if (!this.demo && (this.state === "ride" || this.state === "air") && this.rideT >= RIDE_TIME) {
      this.completed = true;
      this.popup("Made it! +500", "#7ee0a1");
      this.finish(500);
    }

    if (this.state !== "tow" && this.jet) {
      this.jet[0] += 1.7 * this.vp * dt;
      this.jet[1] = Math.max(-1, this.jet[1] - 0.4 * this.H * dt);
      if (this.sx(this.jet[0]) > this.view.w + 200) this.jet = null;
    }

    const target = this.x - (this.demo ? 0.7 : 0.55) * this.view.w / this.ppm;
    this.cam += (target - this.cam) * Math.min(1, 4 * dt);
    this.updateParticles(dt);
  }

  autopilot() {
    const gap = this.x - this.xc - (this.plunging ? this.lc : 0);
    const want = 38 * Math.sin(this.t * 1.1) + (this.u > 0.75 * this.H ? -40 : 0) + (this.u < 0.15 * this.H ? 40 : 0);
    return {
      up: this.a < want - 6, down: this.a > want + 6,
      right: gap < 0.6 * this.H, left: gap > 1.6 * this.H,
    };
  }

  updateRide(dt, k) {
    const steer = (k.up ? 1 : 0) - (k.down ? 1 : 0);
    this.a = clamp(this.a + steer * TURN_RATE * dt, -MAX_HEADING, MAX_HEADING);
    const ar = rad(this.a);
    // far ahead of the curl the wave is not steep yet: less push, pumping stops working
    const gap = this.x - this.xc - (this.plunging ? this.lc : 0);
    const power = clamp(1 - (gap - 2 * this.H) / (3 * this.H), 0.35, 1);
    if (k.right && power > 0.5) this.s += PUMP * dt;
    if (k.left) this.s -= BRAKE * dt;
    const s0 = this.s0 * power;
    this.s += (-FACE_GRAVITY * Math.sin(ar) - 0.35 * (this.s - s0)) * dt;
    if (gap > 0 && gap < this.H) {
      this.pocket += POCKET_RATE * dt;
      this.points += POCKET_RATE * dt;
    }
    this.s = clamp(this.s, this.smin, this.smax);
    this.x += this.s * Math.cos(ar) * dt;
    this.u += this.s * Math.sin(ar) * dt;

    if (this.u <= 0) {
      this.u = 0;
      this.s -= 2.5 * dt;                   // off the face, in the flats, no push
      if (this.a < 0) this.a = Math.min(0, this.a + 120 * dt);
    }

    if (this.lipZone && this.u >= 0.85 * this.H && !this.demo) {
      if (this.x < this.xc + 0.35 * this.lc) return this.wipe("The lip landed on you");
      this.u = 0.85 * this.H;               // the throwing lip shoves you back down
      this.a = -30;
      this.s *= 0.85;
      this.popup("Lip!", "#ff6b6b");
    }
    if (this.u >= this.H) {
      const takeOff = this.s * Math.sin(ar) * AIR_KICK;
      if (takeOff > 0.2 * this.vp) {
        this.state = "air";
        this.stateT = 0;
        this.vx = this.s * Math.cos(ar);
        this.vu = takeOff;
        this.spin = 0;
        return;
      }
      this.u = this.H;
      this.a = -Math.abs(this.a) * 0.5 - 12;
    }

    // turns
    if (this.u > 0.8 * this.H && this.a > 15) this.armedTop = true;
    if (this.armedTop && this.a < -15) {
      this.armedTop = false;
      if (this.u > 0.55 * this.H) this.award("Top turn", 60 + 40 * this.s / this.vp);
    }
    if (this.u < 0.2 * this.H && this.a < -15) this.armedBottom = true;
    if (this.armedBottom && this.a > 20) {
      this.armedBottom = false;
      if (this.u < 0.45 * this.H) this.award("Bottom turn", 40 + 30 * this.s / this.vp);
    }

    // barrel
    const inTube = this.lipZone && this.u < 0.85 * this.H;
    if (inTube) {
      this.tubeT += dt;
    } else if (this.tubeT > 0) {
      if (this.tubeT > 0.4) this.award(this.tubeT > 2 ? "Deep barrel" : "Barrel", 300 * this.tubeT);
      this.tubeT = 0;
    }

    const edge = this.plunging ? this.xc : this.xc + this.lc * this.u / this.H;
    if (this.x < edge) {
      if (this.demo) this.x = edge + 0.5;
      else this.wipe("The white water caught you");
    }
  }

  updateAir(dt, k) {
    this.vu -= AIR_GRAVITY * dt;
    this.x += this.vx * dt;
    this.u += this.vu * dt;
    if (!this.demo) this.spin += ((k.left ? 1 : 0) - (k.right ? 1 : 0)) * SPIN_RATE * dt;
    if (this.u <= this.H * 0.97 && this.vu < 0) this.land();
  }

  land() {
    const off = ((this.spin + 180) % 360 + 360) % 360 - 180;
    if (this.x < this.xc + 0.5 && !this.demo) return this.wipe("You landed in the white water");
    let half;
    if (Math.abs(off) <= 60) half = 2 * Math.round(Math.abs(this.spin) / 360);
    else if (Math.abs(off) >= 120) half = 2 * Math.round((Math.abs(this.spin) - 180) / 360) + 1;
    else return this.wipe("You landed sideways");
    const names = { 0: "Air", 1: "Air reverse", 2: "360" };
    this.award(names[half] || `${half * 180}`, 150 + 200 * half);
    this.state = "ride";
    this.stateT = 0;
    this.u = 0.97 * this.H;
    this.a = -35;
    this.s = clamp(Math.max(this.s0, Math.abs(this.vx)), this.smin, this.smax);
  }

  wipe(reason) {
    this.state = "wipeout";
    this.stateT = 0;
    this.reason = reason;
    this.tubeT = 0;
  }

  finish(bonus = 0) {
    if (this.pocket >= 1) this.tricks.push(["In the pocket", Math.round(this.pocket)]);
    this.banked = Math.round((this.points + bonus) * this.mult);
    this.state = "over";
    this.stateT = 0;
    this.result = {
      banked: this.banked, height: this.H, completed: this.completed, reason: this.reason,
      tricks: this.tricks, mult: this.mult, speed: this.c,
    };
  }

  // ------------------------------------------------------------ particles

  updateParticles(dt) {
    const span = this.view.w / this.ppm;
    while (this.streaks.length < 40) {
      this.streaks.push([this.cam + Math.random() * (span + 15) - 5, Math.random() * this.H,
                         1.5 + Math.random() * 5]);
    }
    for (const s of this.streaks) {
      s[1] += 0.12 * this.c * dt;
      if (s[1] > this.H || s[0] + s[2] < this.cam - 5 || s[0] > this.cam + span + 20) {
        s[0] = this.cam + Math.random() * (span + 15) - 5;
        if (s[0] < this.cam) s[0] = this.cam + span + Math.random() * 10;
        s[1] = Math.random() * 0.25 * this.H;
        s[2] = 1.5 + Math.random() * 5;
      }
    }

    if (this.state !== "over") {
      const size = Math.sqrt(this.H / 10);
      for (let n = 0; n < Math.floor(170 * dt) + 1 && this.foam.length < 280; n++) {
        const rel = -(Math.random() ** 1.5) * 0.8 * this.H;
        this.foam.push({ rel, u: (0.15 + 0.85 * Math.random()) * this.pileTop(this.xc + rel),
                         r: (0.4 + 0.8 * Math.random()) * size, age: 0, life: 0.8 + Math.random() });
      }
      for (let n = 0; n < Math.floor(120 * dt * size) + 1 && this.spray.length < 320; n++) {
        const near = Math.random() < 0.7;
        const x = this.xc + (near ? (-0.2 + 1.2 * Math.random()) * this.lc : Math.random() * 3 * this.H);
        this.spray.push({ x, u: this.H * (0.97 + 0.06 * Math.random()), vx: Math.random() * 2 - 1,
                          vu: (1 + 3 * Math.random()) * size * (near ? 1 : 0.5), age: 0,
                          life: 0.4 + 0.7 * Math.random(), r: (0.06 + 0.14 * Math.random()) * size });
      }
    }
    for (const f of this.foam) {
      f.rel -= 0.35 * this.vp * dt;
      f.u = Math.max(0, f.u - 0.08 * this.H * dt);
      f.age += dt;
    }
    this.foam = this.foam.filter((f) => f.age < f.life);
    for (const p of this.spray) {
      p.x += p.vx * dt;
      p.u += p.vu * dt;
      p.vu -= 1.5 * dt;
      p.age += dt;
    }
    this.spray = this.spray.filter((p) => p.age < p.life);
    for (const p of this.popups) { p.rise += 30 * dt; p.life -= dt; }
    this.popups = this.popups.filter((p) => p.life > 0);
    for (const c of this.clouds) c.x += c.speed * dt;
  }

  // ------------------------------------------------------------ drawing

  draw(ctx, w, h) {
    this.view = { w, h };
    this.drawSky(ctx);
    this.drawHeadland(ctx);
    this.drawFace(ctx);
    const behind = this.lipZone && (this.state === "ride" || this.state === "wipeout");
    if (behind) this.drawSurfer(ctx);
    this.drawBreaking(ctx);
    if (!behind) this.drawSurfer(ctx);
    this.drawJetski(ctx);
    this.drawFlats(ctx);
    this.drawPopups(ctx);
    const v = ctx.createRadialGradient(w / 2, h * 0.55, h * 0.35, w / 2, h * 0.55, Math.max(w, h) * 0.8);
    v.addColorStop(0, "rgba(0,8,16,0)");
    v.addColorStop(1, "rgba(0,8,16,0.45)");
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, w, h);
  }

  drawSky(ctx) {
    const { w } = this.view;
    const lip = this.lipY;
    const g = ctx.createLinearGradient(0, 0, 0, lip + 4);
    g.addColorStop(0, "#0b1f3d");
    g.addColorStop(0.5, "#33557d");
    g.addColorStop(0.82, "#d99a8a");
    g.addColorStop(1, "#ffd0a0");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, lip + 4);
    const sx = w * 0.76, sy = Math.max(80, lip - 70);
    const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, 320);
    glow.addColorStop(0, "rgba(255,230,190,0.9)");
    glow.addColorStop(0.12, "rgba(255,210,160,0.5)");
    glow.addColorStop(1, "rgba(255,180,140,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(sx - 320, sy - 320, 640, 640);
    ctx.fillStyle = "#fff4dc";
    ctx.beginPath(); ctx.arc(sx, sy, 26, 0, Math.PI * 2); ctx.fill();
    const par = this.cam * this.ppm * 0.02;
    for (const c of this.clouds) {
      const img = cloudSprites[c.k];
      const cw = img.width * c.scale;
      const x = ((c.x - par) % (w + cw + 200) + (w + cw + 200)) % (w + cw + 200) - cw - 100;
      ctx.drawImage(img, x, c.y * lip, cw, img.height * c.scale);
    }
  }

  drawHeadland(ctx) {
    const bx = this.view.w * 0.3 - this.cam * this.ppm * 0.03;
    const by = this.lipY + 6;
    const g = ctx.createLinearGradient(0, by - 90, 0, by);
    g.addColorStop(0, "rgba(70,84,116,0.95)");
    g.addColorStop(1, "rgba(150,140,150,0.9)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(bx - 700, by);
    ctx.lineTo(bx - 700, by - 84);
    ctx.bezierCurveTo(bx - 420, by - 92, bx - 200, by - 86, bx - 90, by - 64);
    ctx.bezierCurveTo(bx - 40, by - 52, bx + 10, by - 30, bx + 50, by);
    ctx.closePath();
    ctx.fill();
    // fort and lighthouse on the cliff edge
    ctx.fillStyle = "#e9e0cf";
    ctx.fillRect(bx - 128, by - 82, 34, 12);
    ctx.fillStyle = "#e0484a";
    ctx.fillRect(bx - 110, by - 98, 8, 16);
    ctx.fillStyle = "#fff1c8";
    ctx.fillRect(bx - 109, by - 102, 6, 4);
    // haze where the land meets the sea
    const hz = ctx.createLinearGradient(0, by - 90, 0, by);
    hz.addColorStop(0, "rgba(255,208,160,0)");
    hz.addColorStop(1, "rgba(255,208,160,0.35)");
    ctx.fillStyle = hz;
    ctx.fillRect(0, by - 90, this.view.w, 90);
  }

  drawFace(ctx) {
    const { w } = this.view;
    const top = this.lipY, bottom = this.trough;
    const g = ctx.createLinearGradient(0, top, 0, bottom);
    g.addColorStop(0, "#c4f7ee");
    g.addColorStop(0.1, "#6edbd2");
    g.addColorStop(0.38, "#1d93a6");
    g.addColorStop(0.72, "#0c5576");
    g.addColorStop(1, "#06304b");
    ctx.fillStyle = g;
    ctx.fillRect(0, top, w, bottom - top);
    // sun glitter on the face
    const sx = w * 0.76;
    const gl = ctx.createRadialGradient(sx, top + 30, 0, sx, top + 30, (bottom - top) * 0.9);
    gl.addColorStop(0, "rgba(255,236,200,0.35)");
    gl.addColorStop(1, "rgba(255,236,200,0)");
    ctx.fillStyle = gl;
    ctx.fillRect(0, top, w, bottom - top);
    // texture lines being pulled up the face
    ctx.lineCap = "round";
    for (const [x, u, len] of this.streaks) {
      if (u > this.H * 0.97) continue;
      const a = 0.06 + 0.22 * u / this.H;
      ctx.strokeStyle = `rgba(220,255,250,${a})`;
      ctx.lineWidth = 1.5 + u / this.H;
      ctx.beginPath();
      ctx.moveTo(this.sx(x), this.sy(u));
      ctx.lineTo(this.sx(x) + len * this.ppm, this.sy(u));
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 10;
    ctx.beginPath(); ctx.moveTo(0, top + 2); ctx.lineTo(w, top + 2); ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, top); ctx.lineTo(w, top); ctx.stroke();
  }

  drawBreaking(ctx) {
    const H = this.H, ppm = this.ppm;
    const x0 = this.sx(this.xc), lc = this.lc * ppm;
    const top = this.sy(H), bottom = this.sy(0);
    if (this.plunging) {
      const edge = [];
      for (let i = 20; i >= 0; i--) {
        const f = i / 20;
        edge.push([x0 + lc * f, this.sy(H * f ** 1.3)]);
      }
      // dark inside of the barrel
      const sh = ctx.createLinearGradient(x0, 0, x0 + lc, 0);
      sh.addColorStop(0, "rgba(2,24,40,0.65)");
      sh.addColorStop(1, "rgba(2,24,40,0.0)");
      ctx.fillStyle = sh;
      ctx.beginPath();
      ctx.moveTo(x0, bottom);
      ctx.lineTo(x0, top);
      ctx.lineTo(x0 + lc * 1.15, top);
      ctx.lineTo(x0 + lc * 0.75, bottom);
      ctx.closePath();
      ctx.fill();
      // the falling curtain of the lip
      const cg = ctx.createLinearGradient(x0, top, x0 + lc, bottom);
      cg.addColorStop(0, "rgba(214,250,246,0.75)");
      cg.addColorStop(1, "rgba(120,220,215,0.25)");
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.moveTo(x0, top - 2);
      ctx.quadraticCurveTo(x0 + lc * 0.6, top - 0.04 * H * ppm, x0 + lc, top);
      for (const [px, py] of edge) ctx.lineTo(px, py);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.95)";
      ctx.lineWidth = Math.max(3, 0.22 * ppm);
      ctx.lineJoin = "round";
      ctx.beginPath();
      edge.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
      ctx.stroke();
      const mr = Math.max(0.7 * H * ppm, 60);
      const mist = ctx.createRadialGradient(x0 + 0.2 * lc, top, 0, x0 + 0.2 * lc, top, mr);
      mist.addColorStop(0, "rgba(255,255,255,0.75)");
      mist.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = mist;
      ctx.fillRect(x0 + 0.2 * lc - mr, top - mr, 2 * mr, 2 * mr);
    } else {
      ctx.fillStyle = "rgba(240,250,250,0.9)";
      ctx.beginPath();
      ctx.moveTo(x0, bottom);
      ctx.lineTo(x0 + lc, top);
      ctx.lineTo(x0 - 10, this.sy(H * 1.04));
      ctx.closePath();
      ctx.fill();
    }

    // the broken part: a pile of white water behind the curl
    if (x0 > -20) {
      const pg = ctx.createLinearGradient(0, this.sy(H), 0, bottom);
      pg.addColorStop(0, "#ffffff");
      pg.addColorStop(1, "#cfe4ea");
      ctx.fillStyle = pg;
      ctx.beginPath();
      ctx.moveTo(-10, this.view.h);
      for (let i = -10; i <= x0 + 12; i += 10) {
        const xs = Math.min(i, x0);
        ctx.lineTo(xs, this.sy(this.pileTop(this.cam + xs / ppm)));
      }
      ctx.lineTo(x0, this.view.h);
      ctx.closePath();
      ctx.fill();
    }
    for (const f of this.foam) {
      const fx = this.sx(this.xc + f.rel);
      if (fx < -80 || fx > this.view.w + 80) continue;
      const r = Math.max(3, f.r * ppm * (1.2 - 0.6 * f.age / f.life)) * 2.2;
      ctx.globalAlpha = 0.9;
      ctx.drawImage(foamSprite, fx - r, this.sy(f.u) - r, 2 * r, 2 * r);
    }
    for (const p of this.spray) {
      const px = this.sx(p.x);
      if (px < -20 || px > this.view.w + 20) continue;
      const r = Math.max(1.5, p.r * ppm) * 2.4;
      ctx.globalAlpha = 0.75 * (1 - p.age / p.life);
      ctx.drawImage(foamSprite, px - r, this.sy(p.u) - r, 2 * r, 2 * r);
    }
    ctx.globalAlpha = 1;
  }

  drawFlats(ctx) {
    const { w, h } = this.view;
    const y0 = this.trough;
    const g = ctx.createLinearGradient(0, y0, 0, h);
    g.addColorStop(0, "#0e5876");
    g.addColorStop(1, "#03192a");
    ctx.fillStyle = g;
    ctx.fillRect(0, y0, w, h - y0);
    const x0 = this.sx(this.xc);
    if (x0 > 0) {
      const fg = ctx.createLinearGradient(0, y0, 0, y0 + 40);
      fg.addColorStop(0, "rgba(230,245,248,0.95)");
      fg.addColorStop(1, "rgba(230,245,248,0)");
      ctx.fillStyle = fg;
      ctx.fillRect(0, y0, x0, 40);
    }
    ctx.lineCap = "round";
    for (let i = 0; i < 9; i++) {
      const y = y0 + 14 + i * 11;
      const off = (this.cam * this.ppm * (0.6 + i * 0.1)) % 200;
      ctx.strokeStyle = `rgba(120,210,230,${0.16 - i * 0.012})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let k = -1; k < w / 200 + 2; k++) {
        const xa = k * 200 - off + (i * 37) % 100;
        ctx.moveTo(xa, y);
        ctx.lineTo(xa + 50 + i * 8, y);
      }
      ctx.stroke();
    }
  }

  drawSurfer(ctx) {
    if (this.state === "over" && !this.completed) return;
    const pos = [this.sx(this.x), this.sy(this.u)];
    if (this.state === "air") {
      const pitch = Math.atan2(this.vu, this.vx) * 180 / Math.PI * 0.5;
      drawRider(ctx, pos, this.ppm, "crouch", pitch + this.spin, pitch + this.spin);
    } else if (this.state === "wipeout") {
      drawRider(ctx, pos, this.ppm, "fall", -0.6 * this.tumble, this.tumble);
    } else {
      const low = this.lipZone || this.tubeT > 0;
      drawRider(ctx, pos, this.ppm, low ? "crouch" : "stand", this.a, 0.3 * this.a);
    }
  }

  drawJetski(ctx) {
    if (!this.jet) return;
    const ppm = this.ppm;
    const jx = this.sx(this.jet[0]), jy = this.sy(Math.max(this.jet[1], 0)) - 0.3 * ppm;
    if (this.state === "tow") {
      const hx = this.sx(this.x) + 0.7 * ppm, hy = this.sy(this.u + 1.05);
      ctx.strokeStyle = "#ffd166";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.quadraticCurveTo((hx + jx) / 2, (hy + jy) / 2 + 0.3 * ppm, jx - 1.3 * ppm, jy - 0.2 * ppm);
      ctx.stroke();
    }
    ctx.save();
    ctx.translate(jx, jy);
    ctx.scale(ppm, ppm);
    ctx.fillStyle = "#f4f7fb";
    ctx.beginPath();
    ctx.moveTo(-1.6, 0.2);
    ctx.quadraticCurveTo(-1.6, -0.45, -1.1, -0.5);
    ctx.lineTo(1.0, -0.42);
    ctx.quadraticCurveTo(1.7, -0.2, 1.65, 0.15);
    ctx.quadraticCurveTo(0, 0.32, -1.6, 0.2);
    ctx.fill();
    ctx.fillStyle = "#ff7a59";
    ctx.fillRect(-1.5, -0.22, 2.9, 0.14);
    ctx.lineCap = "round";
    ctx.strokeStyle = "#141a24";
    ctx.lineWidth = 0.16;
    ctx.beginPath(); ctx.moveTo(-0.3, -0.55); ctx.lineTo(-0.05, -1.0); ctx.stroke();
    ctx.strokeStyle = "#ff7a59";
    ctx.lineWidth = 0.3;
    ctx.beginPath(); ctx.moveTo(-0.05, -1.0); ctx.lineTo(0.1, -1.5); ctx.stroke();
    ctx.strokeStyle = "#141a24";
    ctx.lineWidth = 0.14;
    ctx.beginPath(); ctx.moveTo(0.1, -1.4); ctx.lineTo(0.6, -1.15); ctx.stroke();
    ctx.fillStyle = "#ffd23f";
    ctx.beginPath(); ctx.arc(0.18, -1.72, 0.17, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  drawPopups(ctx) {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    const outlined = (text, x, y) => {
      ctx.strokeStyle = "rgba(4,16,28,0.55)";
      ctx.lineWidth = 6;
      ctx.strokeText(text, x, y);
      ctx.fillText(text, x, y);
    };
    if (this.tubeT > 0.3) {
      ctx.font = "800 34px Unbounded, Inter, sans-serif";
      ctx.fillStyle = "#4fe3d0";
      outlined(`BARREL ${this.tubeT.toFixed(1)}s`, this.view.w / 2, 110);
    }
    ctx.font = "800 26px Inter, sans-serif";
    this.popups.slice(-3).reverse().forEach((p, i) => {
      ctx.globalAlpha = Math.min(1, p.life * 1.5);
      ctx.fillStyle = p.color;
      outlined(p.text, this.view.w / 2, 170 + i * 40 - p.rise);
    });
    ctx.globalAlpha = 1;
  }
}

// Board and rider; angles in degrees, anticlockwise positive (rider faces right).
export function drawRider(ctx, [x, y], ppm, pose, boardAngle, bodyAngle) {
  const L = 1.05, T = 0.09;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-rad(boardAngle));
  ctx.scale(ppm, ppm);
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.moveTo(-L, 0);
  ctx.quadraticCurveTo(-L, -T, -L + 0.2, -T);
  ctx.lineTo(L - 0.4, -T);
  ctx.quadraticCurveTo(L - 0.05, -T * 0.9, L, -0.02);
  ctx.quadraticCurveTo(L - 0.2, T * 0.6, L - 0.4, T * 0.6);
  ctx.lineTo(-L + 0.15, T * 0.6);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#4fe3d0";
  ctx.fillRect(-L + 0.2, -0.02, 2 * L - 0.55, 0.05);
  ctx.restore();

  const P = POSES[pose].map(([px, py]) => [px, -py]);
  const [bf, bk, ff, fk, hip, sh, head, be, bh, fe, fh] = P;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-rad(bodyAngle));
  ctx.scale(ppm, ppm);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const line = (pts, width, color) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.stroke();
  };
  line([bf, bk, hip], 0.17, "#121821");
  line([ff, fk, hip], 0.17, "#121821");
  line([sh, be, bh], 0.13, "#121821");
  line([sh, fe, fh], 0.13, "#121821");
  line([hip, sh], 0.34, "#ff7a59");
  ctx.fillStyle = "#e8b48f";
  ctx.beginPath(); ctx.arc(head[0], head[1], 0.15, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#ffd23f";
  ctx.beginPath(); ctx.arc(head[0] - 0.02, head[1] - 0.03, 0.16, Math.PI, Math.PI * 2.05); ctx.fill();
  ctx.restore();
}
