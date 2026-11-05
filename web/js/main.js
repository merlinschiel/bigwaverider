import { compass, forecast, loadBathymetry, waveEnergy } from "./physics.js";
import { SwellMap } from "./map.js";
import { SurfGame } from "./surf.js";
import * as lb from "./leaderboard.js";

const $ = (id) => document.getElementById(id);

// the real depth grid drives both the map and the wave physics
await loadBathymetry();

// The picker starts with all sliders in the middle: finding the swell that makes the
// biggest wave is the player's job
const START_SWELL = { period: 14, dir: 290, size: 5 };
// swell behind the wave on the home screen (not shown to the player as a choice)
const DEMO_SWELL = { period: 18, dir: 300, size: 7 };
// Offshore height of each wave in a session as a multiple of Hs; the last is the set wave
const SET_SEQUENCE = [1.0, 1.4, 1.8];
const WAVE_NAMES = ["Wave 1 of 3", "Wave 2 of 3", "Set wave"];

const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ } },
};

const state = {
  screen: "home",
  overlay: null,
  swell: { ...START_SWELL },
  fc: null,          // forecast of the locked-in swell, null while picking
  locked: false,
  demoFc: null,      // forecast for the home screen wave
  game: null,
  session: null,
  paused: false,
  endShown: false,
  keys: { up: false, down: false, left: false, right: false },
  best: store.get("nazare-best", 0),
};

// ---------------------------------------------------------------- canvas

const sea = $("sea");
const ctx = sea.getContext("2d");
const view = { w: 1280, h: 720, scale: 1, dpr: 1 };

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cw = window.innerWidth, ch = window.innerHeight;
  sea.width = Math.round(cw * dpr);
  sea.height = Math.round(ch * dpr);
  view.scale = Math.min(ch / 720, cw / 560);
  view.w = cw / view.scale;
  view.h = ch / view.scale;
  view.dpr = dpr;
}
window.addEventListener("resize", resize);
resize();

// a placeholder wave for the home screen until the first forecast is ready
const DEMO_WAVE = { height: 16, speed: 19, breaker: "plunging", depth: 20, iribarren: 0.6 };
state.game = new SurfGame(DEMO_WAVE, { demo: true });

// --------------------------------------------------------------- screens

function show(screen) {
  state.screen = screen;
  for (const s of document.querySelectorAll(".screen")) s.classList.toggle("active", s.id === screen);
  if (document.activeElement) document.activeElement.blur();
  if (screen === "swell") enterSwell();
  if (screen === "home" && !state.game?.demo) {
    const fc = state.fc || state.demoFc;
    state.game = new SurfGame(fc ? fc.setWave() : DEMO_WAVE, { demo: true });
  }
}

function overlay(id) {
  state.overlay = id;
  for (const o of document.querySelectorAll(".overlay")) o.classList.toggle("active", o.id === id);
  if (document.activeElement) document.activeElement.blur();
}

for (const b of document.querySelectorAll("[data-go]")) {
  b.addEventListener("click", () => show(b.dataset.go));
}

// ---------------------------------------------------------- swell picker

const map = new SwellMap($("map"));
map.swell = state.swell;
map.onDirection = (dir) => { state.swell.dir = dir; syncSliders(); };
const sliders = { period: $("period"), dir: $("dir"), size: $("size") };

function syncSliders() {
  const s = state.swell;
  sliders.period.value = s.period;
  sliders.dir.value = s.dir;
  sliders.size.value = s.size;
  updateLabels();
}

function updateLabels() {
  const s = state.swell;
  $("v-period").textContent = `${s.period} s`;
  $("v-dir").textContent = `${compass(s.dir)} (${s.dir} deg)`;
  $("v-size").textContent = `${s.size} m`;
  for (const el of Object.values(sliders)) {
    const t = (el.value - el.min) / (el.max - el.min);
    el.style.setProperty("--fill", `${t * 100}%`);
  }
}

for (const [key, el] of Object.entries(sliders)) {
  el.addEventListener("input", () => {
    state.swell[key] = Number(el.value);
    updateLabels();
  });
}

// Two steps: pick the swell blind, then lock it in to see the waves it makes. Once
// locked, the swell stays until the session is over and the player picks a new one.
function enterSwell() {
  syncSliders();
  setSwellMode(state.locked);
  if (state.locked) fillReveal(false);
  requestAnimationFrame(() => map.resize());
}

function setSwellMode(revealed) {
  $("pick").hidden = revealed;
  $("reveal").hidden = !revealed;
  $("swell").classList.toggle("picking", !revealed);
  map.interactive = !revealed;
  map.setForecast(revealed ? state.fc : null);
}

function lockIn() {
  if (state.locked || $("lock-in").disabled) return;
  const s = state.swell;
  // the forecast traces rays over two sea floors and takes a moment: show that first
  $("lock-in").disabled = true;
  $("lock-in").textContent = "Reading the sea floor...";
  setTimeout(() => {
    state.fc = forecast(s.period, s.dir, s.size);
    state.locked = true;
    $("lock-in").disabled = false;
    $("lock-in").textContent = "Lock in swell";
    setSwellMode(true);
    fillReveal(true);
  }, 40);
}

function unlock() {
  state.locked = false;
  state.fc = null;
}

function fillReveal(animate) {
  const s = state.swell, fc = state.fc;
  const big = fc.setWave(), plain = fc.setWave(false);
  const top = Math.max(25, big.height, plain.height);
  $("picked").textContent = `${s.period} s waves from the ${compass(s.dir)}, ${s.size} m high in deep water`;
  $("r-canyon").textContent = `${big.height.toFixed(0)} m`;
  $("r-plain").textContent = `${plain.height.toFixed(0)} m`;
  const bars = () => {
    $("b-canyon").style.width = `${(big.height / top) * 100}%`;
    $("b-plain").style.width = `${(plain.height / top) * 100}%`;
  };
  if (animate) {
    $("b-canyon").style.width = $("b-plain").style.width = "0%";
    requestAnimationFrame(() => requestAnimationFrame(bars));
    countUp($("r-height"), big.height, 1100);
  } else {
    bars();
    $("r-height").textContent = big.height.toFixed(0);
  }
  const gain = fc.canyonGain;
  let msg;
  if (s.period < 11) msg = "Short swell hardly feels the sea floor, so the canyon does very little.";
  else if (gain >= 1.25) msg = "The canyon bends the swell and focuses it onto the beach. Watch the crests cross.";
  else msg = "From this direction the focused energy misses the beach.";
  if (big.breaker === "plunging") msg += " Long swell breaks steep and hollow: look for the barrel.";
  $("r-explain").textContent = msg;
  const tooSmall = big.height < 1;
  $("surf-it").textContent = tooSmall ? "Too small to surf, pick again" : "Surf it";
}

function countUp(el, target, ms) {
  const t0 = performance.now();
  const step = (now) => {
    const t = Math.min((now - t0) / ms, 1);
    el.textContent = (target * (1 - (1 - t) ** 3)).toFixed(0);
    if (t < 1) requestAnimationFrame(step);
  };
  el.textContent = "0";
  requestAnimationFrame(step);
}

$("lock-in").addEventListener("click", lockIn);
$("surf-it").addEventListener("click", surfIt);

// --------------------------------------------------------------- session

function surfIt() {
  if (!state.fc) return;
  if (state.fc.setWave().height < 1) { unlock(); return enterSwell(); }
  if (!store.get("nazare-tutorial", false)) {
    tutorialThen = startSession;
    overlay("tutorial");
    return;
  }
  startSession();
}

let tutorialThen = null;
$("tutorial-go").addEventListener("click", () => {
  store.set("nazare-tutorial", true);
  overlay(null);
  const then = tutorialThen;
  tutorialThen = null;
  if (then) then();
});

function startSession() {
  overlay(null);
  state.session = { fc: state.fc, swell: { ...state.swell }, scores: [], posted: false };
  nextWave();
}

function nextWave() {
  const sess = state.session;
  overlay(null);
  if (sess.scores.length >= SET_SEQUENCE.length) return showFinal();
  const i = sess.scores.length;
  const wave = sess.fc.wave(SET_SEQUENCE[i] * sess.fc.h0);
  state.game = new SurfGame(wave, { index: i });
  state.endShown = false;
  state.paused = false;
  $("h-wave").textContent = WAVE_NAMES[i];
  $("h-info").textContent = `${wave.height.toFixed(1)} m · ${(wave.speed * 3.6).toFixed(0)} km/h`;
  show("surf");
}

function showWaveEnd() {
  const g = state.game, r = g.result, sess = state.session;
  sess.scores.push(r);
  const i = sess.scores.length - 1;
  $("we-kicker").textContent = WAVE_NAMES[i];
  $("we-title").textContent = r.completed ? "Clean ride" : "Wipeout";
  $("we-title").style.color = r.completed ? "var(--good)" : "var(--bad)";
  $("we-points").textContent = r.banked.toLocaleString();
  const list = $("we-tricks");
  list.innerHTML = "";
  const tricks = [...r.tricks].sort((a, b) => b[1] - a[1]).slice(0, 3);
  for (const [name, pts] of tricks) {
    const li = document.createElement("li");
    li.innerHTML = `<span></span><b></b>`;
    li.firstChild.textContent = name;
    li.lastChild.textContent = `+${pts}`;
    list.appendChild(li);
  }
  if (r.mult > 1) {
    const li = document.createElement("li");
    li.innerHTML = `<span>Wave size bonus</span><b>x${r.mult.toFixed(1)}</b>`;
    list.appendChild(li);
  }
  const kmh = (r.speed * 3.6).toFixed(0);
  const facts = [
    `This wave moved at ${kmh} km/h. Far too fast to paddle into, so you get towed in.`,
    `Wave energy grows with height squared: this one packs ${(waveEnergy(r.height) / 1000).toFixed(0)} kJ in every square metre.`,
    `Set waves are about 1.8 times the average wave. The canyon made this swell ${sess.fc.canyonGain.toFixed(1)}x bigger.`,
  ];
  $("we-fact").textContent = (r.completed ? "" : `${r.reason}. `) + facts[i];
  $("we-next").textContent = i === SET_SEQUENCE.length - 1 ? "See results" : "Next wave";
  overlay("wave-end");
}

$("we-next").addEventListener("click", nextWave);

function showFinal() {
  const sess = state.session;
  const total = sess.scores.reduce((s, r) => s + r.banked, 0);
  const isNew = total > state.best;
  if (isNew) { state.best = total; store.set("nazare-best", total); }
  $("f-total").textContent = total.toLocaleString();
  $("f-record").textContent = isNew ? "New high score" : `High score ${state.best.toLocaleString()}`;
  $("f-record").classList.toggle("new", isNew);
  const box = $("f-waves");
  box.innerHTML = "";
  sess.scores.forEach((r, i) => {
    const d = document.createElement("div");
    d.className = "wave-col" + (r.completed ? "" : " wipe");
    d.innerHTML = `<span>${["Wave 1", "Wave 2", "Set wave"][i]}</span><b>${r.height.toFixed(0)} m</b><span>${r.banked.toLocaleString()} pts</span>`;
    box.appendChild(d);
  });
  const gain = sess.fc.canyonGain;
  $("f-fact").textContent = gain >= 1.15
    ? `The canyon made your waves ${gain.toFixed(1)}x bigger than a normal beach would.`
    : "This swell barely felt the canyon. Try a long swell from the west-northwest.";
  overlay("final");
  showLeaderboard(total);
}

// ----------------------------------------------------------- leaderboard

const touchOnly = matchMedia("(pointer: coarse)").matches;
const nameInput = $("lb-name");
nameInput.value = store.get("nazare-name", "");

function showLeaderboard(total) {
  if (!lb.enabled()) return;
  const sess = state.session;
  $("f-lb").hidden = false;
  $("lb-form").hidden = !!sess.posted;
  if (sess.posted) return;
  $("lb-send").disabled = false;
  $("lb-send").textContent = "Post score";
  setStatus(`Post ${total.toLocaleString()} points to the class board`);
  $("lb-list").innerHTML = "";
  lb.fetchBoard({ limit: 5 })
    .then((d) => { if (state.session === sess && !sess.posted) renderList($("lb-list"), d.top); })
    .catch(() => {});
  if (!touchOnly) nameInput.focus();
}

$("lb-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const sess = state.session;
  const name = nameInput.value.trim();
  if (!name) { nameInput.focus(); return setStatus("Type a name first", "bad"); }
  store.set("nazare-name", name);
  const total = sess.scores.reduce((s, r) => s + r.banked, 0);
  $("lb-send").disabled = true;
  $("lb-send").textContent = "Posting...";
  setStatus("Saving your score");
  try {
    const d = await lb.submitScore(name, total, sess.swell);
    sess.posted = true;
    $("lb-form").hidden = true;
    nameInput.blur();
    const better = d.best > total ? ` Your best today is ${d.best.toLocaleString()}.` : "";
    setStatus(`You are #${d.rank} of ${d.players} today.${better}`, d.rank === 1 ? "good" : "");
    renderList($("lb-list"), d.top, d.you, d.rank, d.best);
  } catch (err) {
    $("lb-send").disabled = false;
    $("lb-send").textContent = "Try again";
    setStatus(err.final ? err.message : "Could not reach the leaderboard. Check the connection and try again.", "bad");
  }
});

function setStatus(text, tone = "") {
  const el = $("lb-status");
  el.textContent = text;
  el.className = "lb-status" + (tone ? ` ${tone}` : "");
}

// top: [{ name, score }]; you/rank/best add the player's own row when it is not in the top
function renderList(list, top, you = null, rank = 0, best = 0, flash = null) {
  list.innerHTML = "";
  const row = (place, name, score, cls = "") => {
    const li = document.createElement("li");
    li.className = cls + (place <= 3 ? ` p${place}` : "");
    li.innerHTML = "<i></i><span></span><b></b>";
    li.children[0].textContent = place;
    li.children[1].textContent = name;
    li.children[2].textContent = score.toLocaleString();
    list.appendChild(li);
    return li;
  };
  if (!top.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No scores yet today. Be the first.";
    list.appendChild(li);
    return;
  }
  const key = you && you.toLowerCase();
  top.forEach((r, i) => {
    const li = row(i + 1, r.name, r.score, r.name.toLowerCase() === key ? "you" : "");
    if (flash && flash(r)) li.classList.add("flash");
  });
  if (you && rank > top.length) row(rank, you, best, "you gap");
}

// ------------------------------------------------- projector board (?board)

const params = new URLSearchParams(location.search);
const boardMode = params.has("board");

function startBoard() {
  show("board");
  const allTime = params.get("board") === "all";
  const gameUrl = location.origin + location.pathname;
  $("bd-url").textContent = gameUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
  drawQr(gameUrl);
  if (!lb.enabled()) {
    $("bd-meta").textContent = "Leaderboard not set up yet: add the Google Sheet link in js/leaderboard.js";
    return;
  }
  let seen = null;
  const poll = async () => {
    try {
      const d = await lb.fetchBoard({ limit: 16, allTime });
      const prev = seen;
      seen = new Map(d.top.map((r) => [r.name.toLowerCase(), r.score]));
      const who = d.players === 1 ? "1 surfer" : `${d.players} surfers`;
      $("bd-meta").textContent = allTime ? `${who} all time` : `${who} today`;
      renderList($("bd-list"), d.top, null, 0, 0, prev && ((r) => prev.get(r.name.toLowerCase()) !== r.score));
    } catch {
      if (!seen) $("bd-meta").textContent = "Cannot reach the leaderboard, retrying...";
    }
    setTimeout(poll, 5000);
  };
  poll();
}

function drawQr(url) {
  const s = document.createElement("script");
  s.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js";
  s.onload = () => {
    const qr = window.qrcode(0, "M");
    qr.addData(url);
    qr.make();
    $("bd-qr").innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  };
  s.onerror = () => $("bd-qr").remove();
  document.head.appendChild(s);
}

$("f-again").addEventListener("click", startSession);
$("f-swell").addEventListener("click", () => { overlay(null); unlock(); show("swell"); });

// ----------------------------------------------------------------- pause

function pause(on) {
  if (state.screen !== "surf" || !state.game || state.game.state === "over") return;
  state.paused = on;
  overlay(on ? "pause" : null);
}
$("pause-btn").addEventListener("click", () => pause(true));
$("p-resume").addEventListener("click", () => pause(false));
$("p-help").addEventListener("click", () => {
  tutorialThen = () => pause(true);
  overlay("tutorial");
});
$("p-quit").addEventListener("click", () => { state.paused = false; overlay(null); show("swell"); });

// ----------------------------------------------------------------- input

const KEYMAP = {
  ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down",
  ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right",
};

window.addEventListener("keydown", (e) => {
  if (boardMode || e.target.matches?.("input[type=text], textarea")) return;
  const k = KEYMAP[e.code];
  const confirm = e.code === "Enter" || e.code === "NumpadEnter" || e.code === "Space";
  if (k && state.screen === "surf") { state.keys[k] = true; e.preventDefault(); }
  if (confirm) e.preventDefault();
  if (e.repeat) return;

  if (state.overlay === "tutorial" && confirm) return $("tutorial-go").click();
  if (state.overlay === "wave-end" && confirm) return nextWave();
  if (state.overlay === "final") {
    if (confirm) return startSession();
    if (e.code === "Escape" || e.code === "KeyL") { overlay(null); unlock(); return show("swell"); }
    return;
  }
  if (state.overlay === "pause") {
    if (e.code === "Escape" || confirm || e.code === "KeyP") pause(false);
    return;
  }
  if (state.screen === "home" && confirm) return show("swell");
  if (state.screen === "swell") {
    if (confirm) return state.locked ? surfIt() : lockIn();
    if (e.code === "Escape") return show("home");
  }
  if (state.screen === "surf") {
    if (e.code === "Space" && state.game.state === "tow") state.game.release();
    if (e.code === "Escape" || e.code === "KeyP") pause(true);
  }
});
window.addEventListener("keyup", (e) => {
  const k = KEYMAP[e.code];
  if (k) state.keys[k] = false;
});
window.addEventListener("blur", () => { for (const k in state.keys) state.keys[k] = false; });

// touch controls
if (matchMedia("(pointer: coarse)").matches || "ontouchstart" in window) document.body.classList.add("touch-on");
for (const b of document.querySelectorAll("#touch button")) {
  const key = b.dataset.key;
  const set = (on) => (e) => {
    e.preventDefault();
    state.keys[key] = on;
    b.classList.toggle("held", on);
    if (on && state.game?.state === "tow") state.game.release();
  };
  b.addEventListener("pointerdown", set(true));
  b.addEventListener("pointerup", set(false));
  b.addEventListener("pointercancel", set(false));
  b.addEventListener("pointerleave", set(false));
}
sea.addEventListener("pointerdown", () => {
  if (state.screen === "surf" && state.game?.state === "tow") state.game.release();
});

// ------------------------------------------------------------------ loop

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 1 / 30);
  last = now;
  if (state.screen === "swell") {
    map.draw(dt);
  } else if (state.game) {
    const g = state.game;
    if (!state.paused && !state.overlay) g.update(dt, state.keys);
    else if (g.demo || state.overlay === "wave-end" || state.overlay === "final") g.update(dt, state.keys);
    ctx.setTransform(view.dpr * view.scale, 0, 0, view.dpr * view.scale, 0, 0);
    g.draw(ctx, view.w, view.h);
    if (state.screen === "surf") updateHud(g);
  }
  requestAnimationFrame(frame);
}

function updateHud(g) {
  const banked = state.session ? state.session.scores.reduce((s, r) => s + r.banked, 0) : 0;
  const live = g.state !== "over" ? Math.round(g.points * g.mult) : state.endShown ? 0 : g.banked;
  $("h-score").textContent = (banked + live).toLocaleString();
  $("h-progress").style.width = `${Math.min(g.rideT / 25, 1) * 100}%`;
  if (g.state === "over" && !state.endShown && g.stateT > 0.7) {
    state.endShown = true;
    showWaveEnd();
  }
}

requestAnimationFrame(frame);
syncSliders();
if (boardMode) startBoard();
// compute the default forecast once the first frames are on screen
setTimeout(() => {
  const p = DEMO_SWELL;
  state.demoFc = forecast(p.period, p.dir, p.size);
  if (state.screen === "home" && !state.fc) state.game = new SurfGame(state.demoFc.setWave(), { demo: true });
}, 300);

window.nazareStarted = true;
$("load-error").hidden = true;
