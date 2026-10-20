-- What you have already seen: per contact the time you last had the conversation open at its newest message. Messages
-- received before the baseline (the moment this migration ran) count as seen, so the first run does not mark everything new.
CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO app_settings (key, value) VALUES ('unread_baseline_ms', CAST(strftime('%s', 'now') AS INTEGER) * 1000);

CREATE TABLE read_state (
  contact_id TEXT PRIMARY KEY REFERENCES contacts(id),
  read_ms INTEGER NOT NULL
);
