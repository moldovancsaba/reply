-- Channels are no longer a fixed list in the schema (#287). The channel column of messages, handoffs and sends keeps a SHAPE check
-- (a short lowercase id) instead of enumerating imessage/email/whatsapp, so a new channel needs no table rebuild.
-- SQLite cannot alter a CHECK constraint: each table is rebuilt (create, copy, drop, rename). messages keeps its rowid because the
-- external-content full-text index (messages_fts) is keyed by it. Row counts, sums and the FTS index are verified by the hook
-- registered for version 14 in migrate.js, inside this transaction; any mismatch rolls everything back.

CREATE TABLE messages_new (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL CHECK (length(channel) BETWEEN 1 AND 32 AND channel GLOB '[a-z]*' AND channel NOT GLOB '*[^a-z0-9_-]*'),
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
  meta_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE (channel, account, provider_message_key)
);
INSERT INTO messages_new (rowid, id, channel, account, provider_message_key, thread_key, handle_norm, is_from_me, ts_ms, subject, text, attachments_json, ingested_at, meta_json)
  SELECT rowid, id, channel, account, provider_message_key, thread_key, handle_norm, is_from_me, ts_ms, subject, text, attachments_json, ingested_at, meta_json FROM messages;
DROP TABLE messages;
ALTER TABLE messages_new RENAME TO messages;
CREATE INDEX messages_handle_ts ON messages(handle_norm, ts_ms DESC);
CREATE INDEX messages_ts ON messages(ts_ms DESC);

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
INSERT INTO messages_fts(messages_fts) VALUES ('rebuild');

CREATE TABLE handoffs_new (
  id TEXT PRIMARY KEY,
  ts_ms INTEGER NOT NULL,
  contact_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (length(channel) BETWEEN 1 AND 32 AND channel GLOB '[a-z]*' AND channel NOT GLOB '*[^a-z0-9_-]*'),
  handle_kind TEXT NOT NULL,
  text_length INTEGER NOT NULL
);
INSERT INTO handoffs_new (rowid, id, ts_ms, contact_id, channel, handle_kind, text_length)
  SELECT rowid, id, ts_ms, contact_id, channel, handle_kind, text_length FROM handoffs;
DROP TABLE handoffs;
ALTER TABLE handoffs_new RENAME TO handoffs;
CREATE INDEX handoffs_contact ON handoffs(contact_id, ts_ms DESC);

CREATE TABLE sends_new (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL UNIQUE,
  ts_ms INTEGER NOT NULL,
  contact_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (length(channel) BETWEEN 1 AND 32 AND channel GLOB '[a-z]*' AND channel NOT GLOB '*[^a-z0-9_-]*'),
  handle_kind TEXT NOT NULL,
  text_length INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sending','sent','failed','unknown')),
  error_code TEXT,
  done_ms INTEGER
);
INSERT INTO sends_new (rowid, id, client_id, ts_ms, contact_id, channel, handle_kind, text_length, status, error_code, done_ms)
  SELECT rowid, id, client_id, ts_ms, contact_id, channel, handle_kind, text_length, status, error_code, done_ms FROM sends;
DROP TABLE sends;
ALTER TABLE sends_new RENAME TO sends;
CREATE INDEX sends_ts ON sends(ts_ms DESC);
CREATE INDEX sends_contact ON sends(contact_id, ts_ms DESC);
