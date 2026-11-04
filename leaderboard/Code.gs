// Nazare class leaderboard: Google Apps Script backend.
//
// Paste this whole file into Extensions > Apps Script of a Google Sheet, then
// Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone).
// See README.md in this folder for the step by step version.
//
// Every submitted run becomes one row in the "Scores" tab. The game reads back
// today's board: the best score per name, highest first.

const SHEET_NAME = "Scores";
const HEADER = ["Time", "Name", "Score", "Period (s)", "Direction (deg)", "Size (m)"];
const MAX_NAME = 16;
const MAX_SCORE = 500000;   // far above what a real run can reach; filters obvious fakes
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

// GET: read the board. Parameters: limit (default 10), day ("today" or "all").
function doGet(e) {
  const p = (e && e.parameter) || {};
  return json(board(p.day === "all", clampLimit(p.limit)));
}

// POST: add a run. Body (sent as text/plain to avoid a CORS preflight):
// {"name": "Sam", "score": 1234, "swell": {"period": 18, "dir": 300, "size": 7}}
function doPost(e) {
  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return json({ ok: false, error: "Bad request" });
  }

  const name = cleanName(data.name);
  const score = Math.round(Number(data.score));
  if (!name) return json({ ok: false, error: "Please enter a name" });
  if (!isFinite(score) || score < 0 || score > MAX_SCORE) return json({ ok: false, error: "Invalid score" });

  const swell = data.swell || {};
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    sheet().appendRow([new Date(), name, score, num(swell.period), num(swell.dir), num(swell.size)]);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  const result = board(false, clampLimit(data.limit));
  const key = name.toLowerCase();
  const idx = result.all.findIndex((r) => r.name.toLowerCase() === key);
  result.rank = idx + 1;
  result.best = idx >= 0 ? result.all[idx].score : score;
  result.you = name;
  return json(result);
}

// Best score per name (case-insensitive), highest first.
function board(allTime, limit) {
  const values = sheet().getDataRange().getValues().slice(1);
  const tz = Session.getScriptTimeZone();
  const today = Utilities.formatDate(new Date(), tz, "yyyy-MM-dd");
  const best = {};
  for (const row of values) {
    const time = row[0], name = String(row[1] || ""), score = Number(row[2]);
    if (!name || !isFinite(score)) continue;
    if (!allTime && !(time instanceof Date && Utilities.formatDate(time, tz, "yyyy-MM-dd") === today)) continue;
    const key = name.toLowerCase();
    if (!best[key] || score > best[key].score) best[key] = { name: name, score: score };
  }
  const all = Object.keys(best).map((k) => best[k]).sort((a, b) => b.score - a.score);
  return { ok: true, day: allTime ? "all" : today, players: all.length, top: all.slice(0, limit), all: all };
}

function json(obj) {
  if (obj.all) delete obj.all;   // internal only, never sent
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function sheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(HEADER);
    sh.setFrozenRows(1);
  }
  return sh;
}

// Plain text only: no control characters, no leading characters that Sheets would
// read as a formula, collapsed spaces, limited length.
function cleanName(raw) {
  return String(raw == null ? "" : raw)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[=+\-@'\s]+/, "")
    .slice(0, MAX_NAME)
    .trim();
}

function clampLimit(v) {
  const n = Math.round(Number(v));
  return n >= 1 ? Math.min(n, MAX_LIMIT) : DEFAULT_LIMIT;
}

function num(v) {
  const n = Number(v);
  return isFinite(n) ? n : "";
}
