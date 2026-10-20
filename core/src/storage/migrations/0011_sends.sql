-- One row per attempt to send a message from the app. Never the text, the subject or the address.
CREATE TABLE sends (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL UNIQUE,
  ts_ms INTEGER NOT NULL,
  contact_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('imessage','email','whatsapp')),
  handle_kind TEXT NOT NULL,
  text_length INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sending','sent','failed','unknown')),
  error_code TEXT,
  done_ms INTEGER
);
CREATE INDEX sends_ts ON sends(ts_ms DESC);
CREATE INDEX sends_contact ON sends(contact_id, ts_ms DESC);
