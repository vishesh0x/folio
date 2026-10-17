-- Folio schema. Timestamps are unix seconds. Booleans are 0/1.

CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,            -- "pbkdf2$iter$salt$hash" (Step 2)
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,            -- sha256 of the cookie token, never the token itself
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- Site-wide config: name, email, location, social links, favicon asset id, ...
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL                     -- JSON
);

CREATE TABLE assets (
  id         TEXT PRIMARY KEY,            -- random id, also the R2 key prefix
  r2_key     TEXT NOT NULL UNIQUE,
  filename   TEXT NOT NULL,
  mime       TEXT NOT NULL,
  size       INTEGER NOT NULL,
  width      INTEGER,
  height     INTEGER,
  alt        TEXT NOT NULL DEFAULT '',    -- default alt text, overridable per use
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE projects (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  slug         TEXT NOT NULL UNIQUE,
  title        TEXT NOT NULL,
  summary      TEXT NOT NULL DEFAULT '',
  body_md      TEXT NOT NULL DEFAULT '',  -- Obsidian-flavoured markdown
  cover_asset  TEXT REFERENCES assets(id) ON DELETE SET NULL,
  cover_alt    TEXT NOT NULL DEFAULT '',
  tags         TEXT NOT NULL DEFAULT '[]',-- JSON array
  live_url     TEXT,
  source_url   TEXT,
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  featured     INTEGER NOT NULL DEFAULT 0,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  seo_title    TEXT,
  seo_desc     TEXT,
  seo_image    TEXT REFERENCES assets(id) ON DELETE SET NULL,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at   INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_projects_list ON projects(status, sort_order);

-- SEO for the fixed pages: home, projects, now, resume, contact
CREATE TABLE seo_pages (
  page      TEXT PRIMARY KEY,
  title     TEXT, description TEXT, og_asset TEXT REFERENCES assets(id) ON DELETE SET NULL,
  noindex   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE now_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, icon TEXT, sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE now_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id  INTEGER NOT NULL REFERENCES now_categories(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  note         TEXT NOT NULL DEFAULT '',
  link         TEXT,
  status       TEXT NOT NULL DEFAULT 'current' CHECK (status IN ('current','done')),
  started_at   INTEGER, finished_at INTEGER,
  sort_order   INTEGER NOT NULL DEFAULT 0
);

-- Resume builder: sections hold entries; entries hold free-form JSON fields.
CREATE TABLE resume_sections (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL,   -- summary | experience | education | skills | certifications | projects | custom
  title      TEXT NOT NULL,
  visible    INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE resume_entries (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  section_id INTEGER NOT NULL REFERENCES resume_sections(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE, -- set when pulled from Projects
  data       TEXT NOT NULL DEFAULT '{}',
  visible    INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL, email TEXT NOT NULL, subject TEXT, body TEXT NOT NULL,
  is_read    INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_messages_inbox ON messages(is_read, created_at);
