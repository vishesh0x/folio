-- "Last updated" on the Now page. (SQLite cannot add a column with a non-constant default, so 0 = unknown.)
ALTER TABLE now_items ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
