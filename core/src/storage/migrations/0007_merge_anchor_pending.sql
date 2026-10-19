ALTER TABLE merge_log ADD COLUMN anchor_handle TEXT;
CREATE TABLE pending_merges (
  id TEXT PRIMARY KEY,
  ts_ms INTEGER NOT NULL,
  moved_handles_json TEXT NOT NULL,
  anchor_handle TEXT NOT NULL
);
