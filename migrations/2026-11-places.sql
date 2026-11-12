-- Approximate city and region per game (admin only), for a database created before this change.
-- Run once:  npx wrangler d1 execute cake-stack --remote --file migrations/2026-11-places.sql
-- A fresh database needs only schema.sql, which already includes this.
ALTER TABLE runs ADD COLUMN place TEXT;
ALTER TABLE plays ADD COLUMN place TEXT;
