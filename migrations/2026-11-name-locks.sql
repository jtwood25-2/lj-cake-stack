-- Name locks and device tags, for a database created from the schema.sql before 2026-11.
-- Run once:  npx wrangler d1 execute cake-stack --remote --file migrations/2026-11-name-locks.sql
-- A fresh database needs only schema.sql, which already includes these.
ALTER TABLE runs ADD COLUMN device TEXT;
CREATE INDEX IF NOT EXISTS runs_name ON runs (name_key);
CREATE TABLE IF NOT EXISTS claims (
  name_key TEXT PRIMARY KEY,
  device   TEXT NOT NULL,
  at       INTEGER NOT NULL
);
