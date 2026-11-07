// Cake Stack score server: a Cloudflare Worker in front of the static game, with scores in D1.
// A posted score is never trusted. The worker replays the run's tap times through the same
// core the game runs (core.js, generated from game.html by build.py) and records what it gets.
import { replay } from "./core.js";

const MAX_TAPS = 3000;
const MAX_TAP_MS = 120_000;
const TOKEN_MAX_AGE_MS = 6 * 3600_000;
const CLOCK_SLACK_MS = 1500;          // network latency between fetching a token and starting play
const RATE_WINDOW_MS = 3600_000;
const RATE_MAX = 120;                 // per network per hour: a whole reception can share one wifi
const DEVICE_RE = /^[A-Za-z0-9_-]{16,64}$/;
const TAG_LEN = 4;                    // characters of a device or network hash shown on the admin page

const enc = new TextEncoder();
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}
function same(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const json = (o, status = 200) => new Response(JSON.stringify(o), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});
const fail = (error, status = 400) => json({ ok: false, error }, status);
const cleanName = s => String(s ?? "").replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 20);

async function top(env) {
  const { results } = await env.DB.prepare("SELECT name, score FROM best ORDER BY score DESC, at ASC LIMIT 20").all();
  return results;
}

async function start(env) {
  const id = crypto.randomUUID(), at = Date.now();
  return json({ ok: true, token: `${id}.${at}.${await hmac(env.RUN_SECRET, `${id}.${at}`)}` });
}

async function score(req, env) {
  let body;
  try { body = await req.json(); } catch { return fail("invalid"); }

  const name = cleanName(body.name);
  if (!name) return fail("name");
  const key = name.toLowerCase();

  const [id, atStr, sig] = String(body.token ?? "").split(".");
  const at = Number(atStr);
  if (!id || !sig || !Number.isFinite(at) || !same(sig, await hmac(env.RUN_SECRET, `${id}.${at}`))) return fail("token");

  const taps = body.taps;
  if (!Array.isArray(taps) || !taps.length || taps.length > MAX_TAPS ||
      !taps.every(t => Number.isInteger(t) && t >= 0 && t <= MAX_TAP_MS)) return fail("invalid");

  const now = Date.now();
  if (now - at > TOKEN_MAX_AGE_MS) return fail("token");
  // The token was issued before the run began, so it must be at least as old as the run is long.
  const played = taps.reduce((a, b) => a + b, 0);
  if (now - at + CLOCK_SLACK_MS < played) return fail("time");

  const run = replay(taps);
  if (!run.over || run.score < 1) return fail("invalid");

  // Each phone keeps a random device key. It is stored only as a keyed hash: the admin page
  // shows its first characters as a device tag, and a name belongs to the first device to post it.
  const device = String(body.device ?? "");
  if (!DEVICE_RE.test(device)) return fail("device");
  const dev = (await hmac(env.RUN_SECRET, "dev:" + device)).slice(0, 22);

  if (await env.DB.prepare("SELECT 1 FROM banned WHERE name_key = ?").bind(key).first()) return fail("name");

  const ip = (await hmac(env.RUN_SECRET, "ip:" + (req.headers.get("CF-Connecting-IP") || "unknown"))).slice(0, 22);
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM runs WHERE ip_hash = ? AND at > ?").bind(ip, now - RATE_WINDOW_MS).first();
  if (recent.n >= RATE_MAX) return fail("rate", 429);

  // Claim the name for this device if nobody has it, then check who owns it. Checked before the
  // run is recorded, so a player told the name is taken can post the same run under another name.
  await env.DB.prepare("INSERT OR IGNORE INTO claims (name_key, device, at) VALUES (?, ?, ?)").bind(key, dev, now).run();
  const owner = await env.DB.prepare("SELECT device FROM claims WHERE name_key = ?").bind(key).first();
  if (!owner || !same(owner.device, dev)) return fail("taken", 409);

  try {
    await env.DB.prepare("INSERT INTO runs (run_id, ip_hash, at, score, name_key, device) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(id, ip, now, run.score, key, dev).run();
  } catch (e) {
    if (/UNIQUE/i.test(String(e))) return fail("used", 409);
    throw e;
  }
  await env.DB.prepare(
    `INSERT INTO best (name_key, name, score, at) VALUES (?, ?, ?, ?)
     ON CONFLICT(name_key) DO UPDATE SET name = excluded.name, score = excluded.score, at = excluded.at
     WHERE excluded.score > best.score`
  ).bind(key, name, run.score, now).run();

  return json({ ok: true, score: run.score, top: await top(env) });
}

async function admin(req, env, path) {
  const auth = req.headers.get("authorization") || "";
  if (!env.ADMIN_PASSWORD || !same(auth, "Bearer " + env.ADMIN_PASSWORD)) return fail("auth", 401);

  if (path === "/api/admin/scores" && req.method === "GET") {
    // Device and network tags: every distinct one this name has posted from, newest runs included.
    const scores = (await env.DB.prepare(
      `SELECT b.name_key, b.name, b.score, b.at,
         (SELECT group_concat(DISTINCT substr(r.device, 1, ${TAG_LEN})) FROM runs r WHERE r.name_key = b.name_key) AS devices,
         (SELECT group_concat(DISTINCT substr(r.ip_hash, 1, ${TAG_LEN})) FROM runs r WHERE r.name_key = b.name_key) AS networks,
         EXISTS (SELECT 1 FROM claims c WHERE c.name_key = b.name_key) AS locked
       FROM best b ORDER BY b.score DESC, b.at ASC LIMIT 1000`).all()).results;
    const banned = (await env.DB.prepare("SELECT name_key, at FROM banned ORDER BY at DESC").all()).results;
    return json({ ok: true, scores, banned });
  }
  if (path === "/api/admin/release" && req.method === "POST") {
    const { name_key } = await req.json();
    const key = String(name_key ?? "").toLowerCase();
    if (!key) return fail("invalid");
    await env.DB.prepare("DELETE FROM claims WHERE name_key = ?").bind(key).run();
    return json({ ok: true });
  }
  if (path === "/api/admin/remove" && req.method === "POST") {
    const { name_key, ban } = await req.json();
    const key = String(name_key ?? "").toLowerCase();
    if (!key) return fail("invalid");
    await env.DB.prepare("DELETE FROM best WHERE name_key = ?").bind(key).run();
    if (ban) await env.DB.prepare("INSERT OR IGNORE INTO banned (name_key, at) VALUES (?, ?)").bind(key, Date.now()).run();
    return json({ ok: true });
  }
  if (path === "/api/admin/unban" && req.method === "POST") {
    const { name_key } = await req.json();
    await env.DB.prepare("DELETE FROM banned WHERE name_key = ?").bind(String(name_key ?? "").toLowerCase()).run();
    return json({ ok: true });
  }
  return fail("not found", 404);
}

export default {
  async fetch(req, env) {
    const path = new URL(req.url).pathname;
    try {
      if (path === "/api/top" && req.method === "GET") return json({ ok: true, top: await top(env) });
      if (path === "/api/start" && req.method === "POST") return start(env);
      if (path === "/api/score" && req.method === "POST") return score(req, env);
      if (path.startsWith("/api/admin/")) return admin(req, env, path);
      if (path.startsWith("/api/")) return fail("not found", 404);
      return env.ASSETS.fetch(req);
    } catch (e) {
      console.error(e);
      return fail("server", 500);
    }
  }
};
