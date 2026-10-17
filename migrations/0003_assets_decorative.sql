-- Images need alt text unless explicitly marked decorative.
ALTER TABLE assets ADD COLUMN decorative INTEGER NOT NULL DEFAULT 0;
