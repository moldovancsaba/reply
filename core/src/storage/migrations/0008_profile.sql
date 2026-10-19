-- Contact profile: address-book details (imported, replaced on each import) and what the user writes themselves.
CREATE TABLE contact_details (
  contact_id TEXT PRIMARY KEY REFERENCES contacts(id),
  json TEXT NOT NULL,
  updated_ms INTEGER NOT NULL
);

CREATE TABLE contact_profile (
  contact_id TEXT PRIMARY KEY REFERENCES contacts(id),
  profession TEXT NOT NULL DEFAULT '',
  company TEXT NOT NULL DEFAULT '',
  relationship TEXT NOT NULL DEFAULT '',
  linkedin_url TEXT NOT NULL DEFAULT '',
  intro TEXT NOT NULL DEFAULT '',
  updated_ms INTEGER NOT NULL
);

CREATE TABLE contact_notes (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id),
  text TEXT NOT NULL,
  created_ms INTEGER NOT NULL
);
CREATE INDEX contact_notes_contact ON contact_notes(contact_id, created_ms DESC);
