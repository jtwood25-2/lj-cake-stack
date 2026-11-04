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
  name_key TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS runs_ip_at ON runs (ip_hash, at);

-- banned: names removed and blocked from the admin page.
CREATE TABLE IF NOT EXISTS banned (
  name_key TEXT PRIMARY KEY,
  at       INTEGER NOT NULL
);
