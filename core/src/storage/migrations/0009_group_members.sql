-- Members of group chats (WhatsApp), replaced for a group each time the source is read.
CREATE TABLE group_members (
  group_handle TEXT NOT NULL,
  member_handle TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  is_admin INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (group_handle, member_handle)
);
