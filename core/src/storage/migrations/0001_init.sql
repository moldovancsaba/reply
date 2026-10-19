CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL CHECK (channel IN ('imessage','email','whatsapp')),
  account TEXT NOT NULL,
  provider_message_key TEXT NOT NULL,
  thread_key TEXT NOT NULL,
  handle_norm TEXT NOT NULL,
  is_from_me INTEGER NOT NULL CHECK (is_from_me IN (0,1)),
  ts_ms INTEGER NOT NULL,
  subject TEXT,
  text TEXT NOT NULL DEFAULT '',
  attachments_json TEXT NOT NULL DEFAULT '[]',
  ingested_at INTEGER NOT NULL,
  UNIQUE (channel, account, provider_message_key)
);
CREATE INDEX messages_handle_ts ON messages(handle_norm, ts_ms DESC);
CREATE INDEX messages_ts ON messages(ts_ms DESC);

CREATE TABLE handles (
  handle_norm TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('phone','email','whatsapp','other')),
  first_seen_ms INTEGER NOT NULL,
  last_seen_ms INTEGER NOT NULL
);

CREATE TABLE contacts (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('auto','apple_contacts','manual')),
  hidden INTEGER NOT NULL DEFAULT 0,
  created_ms INTEGER NOT NULL
);

CREATE TABLE contact_handles (
  handle_norm TEXT PRIMARY KEY REFERENCES handles(handle_norm),
  contact_id TEXT NOT NULL REFERENCES contacts(id),
  link_origin TEXT NOT NULL CHECK (link_origin IN ('auto','apple_contacts','manual_merge')),
  linked_ms INTEGER NOT NULL
);
CREATE INDEX contact_handles_contact ON contact_handles(contact_id);

CREATE TABLE merge_log (
  id TEXT PRIMARY KEY,
  ts_ms INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('merge','unmerge')),
  from_contact_id TEXT NOT NULL,
  to_contact_id TEXT NOT NULL,
  handles_json TEXT NOT NULL,
  reverted_by TEXT
);

CREATE TABLE contact_summary (
  contact_id TEXT PRIMARY KEY REFERENCES contacts(id),
  last_ts_ms INTEGER NOT NULL,
  last_channel TEXT NOT NULL,
  last_preview TEXT NOT NULL,
  last_from_me INTEGER NOT NULL,
  count_total INTEGER NOT NULL,
  counts_json TEXT NOT NULL
);
CREATE INDEX contact_summary_last ON contact_summary(last_ts_ms DESC, contact_id DESC);

CREATE TABLE sync_state (
  connector TEXT NOT NULL,
  account TEXT NOT NULL,
  cursor_json TEXT NOT NULL DEFAULT '{}',
  state TEXT NOT NULL CHECK (state IN ('idle','running','error','blocked')),
  last_success_ms INTEGER,
  last_error_code TEXT,
  last_error_ms INTEGER,
  messages_total INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (connector, account)
);

CREATE VIRTUAL TABLE messages_fts USING fts5(
  text, subject,
  content='messages', content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, text, subject) VALUES (new.rowid, new.text, new.subject);
END;
CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, text, subject) VALUES ('delete', old.rowid, old.text, old.subject);
END;
CREATE TRIGGER messages_au AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, text, subject) VALUES ('delete', old.rowid, old.text, old.subject);
  INSERT INTO messages_fts(rowid, text, subject) VALUES (new.rowid, new.text, new.subject);
END;
