-- Attempts and time played (admin only), for a database created before this change.
-- Run once:  npx wrangler d1 execute cake-stack --remote --file migrations/2026-11-play-stats.sql
-- A fresh database needs only schema.sql, which already includes this.
CREATE TABLE IF NOT EXISTS plays (
  run_id    TEXT PRIMARY KEY,  -- the token's id, as in runs; a run counts once
  device    TEXT NOT NULL,     -- same keyed hash as runs.device
  ip_hash   TEXT NOT NULL,
  at        INTEGER NOT NULL,
  score     INTEGER NOT NULL,
  played_ms INTEGER NOT NULL,  -- sum of the tap times: active play, not menus
  name_key  TEXT
);
CREATE INDEX IF NOT EXISTS plays_name ON plays (name_key);
CREATE INDEX IF NOT EXISTS plays_device ON plays (device);
CREATE INDEX IF NOT EXISTS plays_ip_at ON plays (ip_hash, at);
