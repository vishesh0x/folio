-- Optional progress (0 to 100) for things you are doing now, shown as a bar on the Now page. NULL = no bar.
ALTER TABLE now_items ADD COLUMN progress INTEGER CHECK (progress IS NULL OR (progress >= 0 AND progress <= 100));
