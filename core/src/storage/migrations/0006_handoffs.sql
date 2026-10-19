CREATE TABLE handoffs (
  id TEXT PRIMARY KEY,
  ts_ms INTEGER NOT NULL,
  contact_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('imessage','email','whatsapp')),
  handle_kind TEXT NOT NULL,
  text_length INTEGER NOT NULL
);
CREATE INDEX handoffs_contact ON handoffs(contact_id, ts_ms DESC);
