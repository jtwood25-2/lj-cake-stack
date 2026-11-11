-- best: one row per player name, holding their best verified score. The leaderboard reads
-- ~20 rows through best_score, which keeps D1's daily read allowance untouched by traffic.
CREATE TABLE IF NOT EXISTS best (
  name_key TEXT PRIMARY KEY,   -- lower-cased name, so "Kennedy" and "kennedy" are one player
  name     TEXT NOT NULL,      -- as last typed, for display
  score    INTEGER NOT NULL,
  at       INTEGER NOT NULL    -- ms since epoch; earlier wins a tie
);
CREATE INDEX IF NOT EXISTS best_score ON best (score DESC, at);

-- runs: every accepted submission. run_id is the token's id, so a token can post only once.
CREATE TABLE IF NOT EXISTS runs (
  run_id   TEXT PRIMARY KEY,
  ip_hash  TEXT NOT NULL,      -- keyed hash of the network address, never the address itself
  at       INTEGER NOT NULL,
  score    INTEGER NOT NULL,
  name_key TEXT NOT NULL,
  device   TEXT                -- keyed hash of the phone's device key (added 2026-11; see migrations/)
);
CREATE INDEX IF NOT EXISTS runs_ip_at ON runs (ip_hash, at);
CREATE INDEX IF NOT EXISTS runs_name ON runs (name_key);

-- claims: a name belongs to the first device that posted it, until released from the admin page.
CREATE TABLE IF NOT EXISTS claims (
  name_key TEXT PRIMARY KEY,
  device   TEXT NOT NULL,      -- same keyed hash as runs.device
  at       INTEGER NOT NULL
);

-- plays: every finished run the game reports, posted or not. Admin-only: attempts and time played.
-- name_key is the last name the phone posted under, or NULL until the phone posts one.
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

-- banned: names removed and blocked from the admin page.
CREATE TABLE IF NOT EXISTS banned (
  name_key TEXT PRIMARY KEY,
  at       INTEGER NOT NULL
);
