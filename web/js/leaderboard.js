// Leaderboard on a Google Sheet (leaderboard/README.md). Empty URL = no leaderboard.
export const LEADERBOARD_URL = "https://script.google.com/macros/s/AKfycbx0gTcYFvw6yHwizNeQWfmcQ-72m9g_CchS9jtIuVVK7P3CKwjKZNedoEXdvFG1W3AtEw/exec";

export const enabled = () => LEADERBOARD_URL !== "";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(params, body, tries = 3) {
  const url = new URL(LEADERBOARD_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  let lastError;
  for (let i = 0; i < tries; i++) {
    try {
      // text/plain avoids a CORS preflight, which Apps Script cannot answer
      const res = await fetch(url, body
        ? { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "text/plain;charset=utf-8" } }
        : { method: "GET", cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.ok) throw Object.assign(new Error(data.error || "Failed"), { final: true });
      return data;
    } catch (err) {
      lastError = err;
      if (err.final) break;
      await wait(600 * (i + 1) + Math.random() * 600);
    }
  }
  throw lastError;
}

// { ok, day, players, top: [{ name, score }] }
export const fetchBoard = ({ limit = 10, allTime = false } = {}) =>
  call({ limit, day: allTime ? "all" : "today" });

// Same as fetchBoard plus { rank, best, you }
export const submitScore = (name, score, swell, limit = 5) =>
  call({}, { name, score, swell: { period: swell.period, dir: swell.dir, size: swell.size }, limit });
