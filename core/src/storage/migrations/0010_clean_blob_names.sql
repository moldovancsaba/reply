-- Earlier WhatsApp imports could name an automatic contact after an encoded push name such as "+CgAQhe2U0gY=".
-- Put the contact's handle back as its name (a later import names it properly if a real name exists).
UPDATE contacts
   SET display_name = COALESCE((SELECT MIN(h.handle_norm) FROM contact_handles h WHERE h.contact_id = contacts.id), display_name)
 WHERE origin = 'auto' AND display_name GLOB '*=' AND display_name NOT LIKE '% %' AND length(display_name) >= 7;
