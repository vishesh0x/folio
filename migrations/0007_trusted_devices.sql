-- Browsers the owner has signed in from. Used only to let the owner through when sign-in is locked after many wrong passwords
-- (see src/lib/auth.ts). Only a hash of each random token is stored; rows go with the account (ON DELETE CASCADE).
CREATE TABLE IF NOT EXISTS trusted_devices (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trusted_user    ON trusted_devices(user_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_trusted_expires ON trusted_devices(expires_at);
