-- Brute-force protection for /auth. One row per "action:ip" key.
CREATE TABLE login_attempts (
  key          TEXT PRIMARY KEY,
  count        INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);
