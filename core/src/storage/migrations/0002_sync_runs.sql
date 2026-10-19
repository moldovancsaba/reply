CREATE TABLE sync_runs (
  id TEXT PRIMARY KEY,
  connector TEXT NOT NULL,
  account TEXT NOT NULL,
  started_ms INTEGER NOT NULL,
  ended_ms INTEGER,
  outcome TEXT NOT NULL CHECK (outcome IN ('running','ok','error','blocked','skipped','aborted')),
  error_code TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  pages INTEGER NOT NULL DEFAULT 0,
  inserted INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  quarantined INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX sync_runs_connector ON sync_runs(connector, started_ms DESC);
