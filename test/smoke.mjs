// Smoke test for the score server, including the cheating attempts it must refuse.
// Runs against `wrangler dev` or the live site, and removes its own test players when done
// (only with ADMIN_PASSWORD set; without it, two "Smoke Test" names stay on the board).
//
//   BASE=http://127.0.0.1:8787 ADMIN_PASSWORD=... node test/smoke.mjs
import { replay } from "../worker/core.js";

const BASE = (process.env.BASE || "http://127.0.0.1:8787").replace(/\/$/, "");
const PW = process.env.ADMIN_PASSWORD || "";
const NAME = `Smoke Test ${Date.now() % 100000}`;
const DEVICE = "smoke-device-" + Math.random().toString(36).slice(2, 12);
const OTHER = "smoke-other-" + Math.random().toString(36).slice(2, 12);
let failures = 0;

const check = (cond, label, got) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${cond ? "" : `   (got ${JSON.stringify(got)})`}`);
  if (!cond) failures++;
};
async function api(path, body, headers = {}) {
  const init = body === undefined ? { headers } : { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) };
  const r = await fetch(BASE + path, init);
  let j = null;
  try { j = await r.json(); } catch {}
  return { status: r.status, ...(j || {}) };
}
const post = (body, device = DEVICE) => api("/api/score", device === null ? body : { ...body, device });
const played = (body, device = DEVICE) => api("/api/played", { ...body, device });
const token = async () => (await api("/api/start", {})).token;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const admin = PW ? { authorization: "Bearer " + PW } : {};

// A believable run that ends in a miss, found by replaying candidate taps through the real core.
function findRun(minPlayed, maxPlayed) {
  for (let seed = 1; seed < 5000; seed++) {
    let s = seed;
    const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
    const taps = [];
    for (let i = 0; i < 60; i++) { taps.push(250 + Math.floor(rnd() * 700)); if (replay(taps).over) break; }
    const r = replay(taps), played = taps.reduce((a, b) => a + b, 0);
    if (r.over && r.score >= 2 && played >= minPlayed && played <= maxPlayed) return { taps, played, score: r.score };
  }
  throw new Error("no suitable run found");
}

const home = await fetch(BASE + "/");
const html = await home.text();
check(home.status === 200 && html.includes('const API_BASE = "/api"'), "game page is served, wired to the score server", home.status);
check((await fetch(BASE + "/admin")).status === 200, "admin page is served", null);
const t0 = await api("/api/top");
check(t0.ok && Array.isArray(t0.top), "leaderboard reads", t0);

const run = findRun(2500, 6000);
const tok = await token();
check(typeof tok === "string" && tok.split(".").length === 3, "a run token is issued", tok);

let r = await post({ token: tok, name: NAME, taps: run.taps });
check(r.error === "time", "refuses a run posted faster than it could have been played", r);

const forged = tok.slice(0, -2) + (tok.endsWith("AA") ? "BB" : "AA");
r = await post({ token: forged, name: NAME, taps: run.taps });
check(r.error === "token", "refuses a forged token", r);

r = await post({ token: await token(), name: NAME, taps: [1336] });
check(r.error === "invalid", "refuses a run that never ended in a miss", r);

r = await post({ token: await token(), name: "   ", taps: [250, 250] });
check(r.error === "name", "refuses a blank name", r);

// Attempts and time played: every finished run is reported, posted or not, and only admin sees them.
const quick = await token();
r = await played({ token: quick, taps: [250, 250] });
check(r.ok, "records a finished run that was never posted", r);
r = await played({ token: quick, taps: [250, 250] });
check(r.error === "used", "counts the same run only once", r);
r = await played({ token: forged, taps: [250, 250] });
check(r.error === "token", "refuses a forged token for play time too", r);
r = await played({ token: await token(), taps: [1336] });
check(r.error === "invalid", "doesn't count a run that never ended", r);
r = await api("/api/top");
check(r.ok && r.top.every(e => Object.keys(e).sort().join() === "name,score"), "the public leaderboard shows only names and scores", r.top);

await sleep(Math.max(0, run.played - 1000));
r = await post({ token: tok, name: NAME, taps: run.taps, score: 999 });
check(r.ok && r.score === run.score, `accepts a genuine run and scores it by replay (${run.score}), ignoring the claimed 999`, r);
check(r.ok && r.top.some(e => e.name === NAME && e.score === run.score), "the run appears on the leaderboard", r.top);

r = await post({ token: tok, name: NAME, taps: run.taps });
check(r.error === "used", "refuses the same run posted twice", r);
r = await played({ token: tok, taps: run.taps });
check(r.ok, "the posted run is counted as an attempt too", r);

r = await post({ token: await token(), name: NAME, taps: [250, 250] });
const entry = r.ok && r.top.find(e => e.name === NAME);
check(r.ok && entry && entry.score === run.score, "a lower score never replaces a player's best", r);

r = await post({ token: await token(), name: NAME, taps: [250, 250] }, null);
check(r.error === "device", "refuses a score without a device key", r);

const spare = await token();
r = await post({ token: spare, name: NAME.toUpperCase(), taps: [250, 250] }, OTHER);
check(r.error === "taken", "another phone can't post under a taken name, in any capitalisation", r);
r = await post({ token: spare, name: NAME + " B", taps: [250, 250] }, OTHER);
check(r.ok, "the refused run can still post under a different name", r);

r = await api("/api/admin/scores", undefined, {});
check(r.status === 401, "admin refuses a request without the password", r.status);

if (!PW) {
  console.log("SKIP  admin checks (set ADMIN_PASSWORD to run them)");
} else {
  r = await api("/api/admin/scores", undefined, admin);
  const row = r.ok && r.scores.find(s => s.name === NAME);
  check(!!row, "admin lists the player", r);
  check(row && row.locked && /^[\w-]{4}$/.test(row.devices) && /^[\w-]{4}$/.test(row.networks),
    "admin shows the name as locked, with one device tag and one network tag", row);
  // The unposted quick run moved under the name when this phone first posted; the low-score post
  // has no play report (like a run from before plays were recorded), so it counts with no time.
  check(row && row.attempts === 3 && row.played_ms === 500 + run.played,
    `admin shows 3 attempts and ${500 + run.played} ms played`, row);
  check(r.totals && r.totals.attempts >= 3 && r.totals.played_ms >= 500 + run.played, "admin shows wedding-wide totals", r.totals);
  check(r.totals && Number.isInteger(r.totals.stacks) && r.totals.stacks >= run.score,
    "admin shows total tiers stacked across every game", r.totals);
  check(row && typeof row.places === "string" && row.places.length > 0 && !/\d+\.\d+\.\d+\.\d+|:/.test(row.places),
    "admin shows the player's approximate place, never an address", row && row.places);
  check(Array.isArray(r.places) && r.places.some(p => row && row.places.split("|").includes(p.place) && p.attempts >= 1),
    "admin lists top places", r.places);
  r = await api("/api/admin/release", { name_key: NAME.toLowerCase() }, admin);
  check(r.ok, "admin releases the name", r);
  r = await post({ token: await token(), name: NAME, taps: [250, 250] }, OTHER);
  check(r.ok, "after release, a different phone can claim the name", r);
  r = await post({ token: await token(), name: NAME, taps: [250, 250] });
  check(r.error === "taken", "and the first phone no longer can", r);
  r = await api("/api/admin/remove", { name_key: NAME.toLowerCase(), ban: true }, admin);
  check(r.ok, "admin removes and blocks a name", r);
  r = await post({ token: await token(), name: NAME, taps: [250, 250] });
  check(r.error === "name", "a blocked name can't post again", r);
  r = await api("/api/admin/unban", { name_key: NAME.toLowerCase() }, admin);
  for (const n of [NAME, NAME + " B"]) {
    await api("/api/admin/remove", { name_key: n.toLowerCase(), ban: false }, admin);
    await api("/api/admin/release", { name_key: n.toLowerCase() }, admin);
  }
  const after = await api("/api/admin/scores", undefined, admin);
  check(r.ok && !after.banned.some(b => b.name_key === NAME.toLowerCase()) &&
    !after.scores.some(s => s.name === NAME || s.name === NAME + " B"),
    "cleanup: test players removed, released and unblocked", after);
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
