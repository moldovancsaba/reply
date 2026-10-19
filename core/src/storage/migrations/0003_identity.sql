ALTER TABLE contacts ADD COLUMN external_id TEXT;
CREATE UNIQUE INDEX contacts_external ON contacts(external_id) WHERE external_id IS NOT NULL;
ALTER TABLE contacts ADD COLUMN merged_into TEXT;
