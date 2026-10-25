-- Indexes found missing by EXPLAIN QUERY PLAN (tests/tools/query-plans.py). All are IF NOT EXISTS, so re-running is harmless, and none of
-- the application code depends on them: they only make the same queries cheaper, so deploying code and migration in either order is safe.

-- Inbox ("all" list, newest first) and the dashboard's latest five: used to scan and sort the whole table. Rows are added by anyone using the
-- contact form, so this table is the one that can grow without the owner doing anything.
CREATE INDEX IF NOT EXISTS idx_messages_recent ON messages(created_at);

-- Files page (newest first), and ![[picture.png]] lookups by file name (a scan of every asset, calling lower() on each, per name per page build)
CREATE INDEX IF NOT EXISTS idx_assets_created  ON assets(created_at);
CREATE INDEX IF NOT EXISTS idx_assets_filename ON assets(lower(filename), created_at);

-- Foreign keys: the child column needs an index, or every "ON DELETE CASCADE / SET NULL" scans the child table, and every list of a
-- parent's children is a scan. The resume one also replaces an index SQLite was building in memory on every public resume render.
CREATE INDEX IF NOT EXISTS idx_now_items_category     ON now_items(category_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_resume_entries_section ON resume_entries(section_id, visible, sort_order);
CREATE INDEX IF NOT EXISTS idx_resume_entries_project ON resume_entries(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_projects_cover         ON projects(cover_asset)      WHERE cover_asset IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_projects_seo_image     ON projects(seo_image)        WHERE seo_image IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_seo_pages_og           ON seo_pages(og_asset)        WHERE og_asset IS NOT NULL;

-- Pruning old rate-limit rows (see src/lib/throttle.ts)
CREATE INDEX IF NOT EXISTS idx_attempts_window ON login_attempts(window_start);

-- sessions.user_id is a foreign key too (ON DELETE CASCADE); the table is tiny, but "every foreign key is indexed" is a rule worth having
-- without exceptions, and "sign out everywhere" style queries filter on it.
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
