-- The address-book thumbnail of a person (JPEG or PNG, at most 48 KB, checked on import). Import data: it is replaced or
-- removed on every contacts sync and comes back after a rebuild.
CREATE TABLE contact_photos (
  contact_id TEXT PRIMARY KEY REFERENCES contacts(id),
  mime TEXT NOT NULL CHECK (mime IN ('image/jpeg','image/png')),
  data BLOB NOT NULL,
  updated_ms INTEGER NOT NULL
);
