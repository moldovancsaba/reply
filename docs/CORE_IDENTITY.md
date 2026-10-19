# Reply Core Identity

Status: living document, owned by issue #189.

One person, many handles. Reply Core groups handles under a **contact** and shows one timeline per contact. The rules below keep that grouping trustworthy.

## Rules

1. **Merge and unmerge are explicit user actions only.** Nothing links handles by name, email domain, number resemblance or channel. (A test scans the code for similarity matching.)
2. **Every handle has exactly one contact.** The first time a handle is seen it gets its own `auto` contact named after the handle, so every message always belongs to a contact.
3. **The user's address book is authoritative over `auto` links.** Importing a person from Apple Contacts links all of their handles to one contact and retires the empty `auto` contacts those handles had.
4. **A manual merge is never overridden** by an import.
5. **Every merge is reversible** and recorded in `merge_log` (handles only, never message content).

## Normalization

`normalizeHandle(raw, hint?, region = REPLY_CORE_DEFAULT_REGION)` returns `{ handle_norm, kind }` or `null`. Pure and cached.

| Input | `handle_norm` | `kind` |
|---|---|---|
| `+36 30 123 4567`, `06 30 123 4567`, `0036301234567`, `tel:+36301234567` | `+36301234567` | `phone` |
| `36301234567` (no `+`, full international number) | `+36301234567` | `phone` |
| `Anna@Example.COM`, ` mailto:Anna@Example.com?subject=x ` | `anna@example.com` | `email` |
| `36301234567@s.whatsapp.net`, `@c.us`, hint `whatsapp` | `+36301234567@wa` | `whatsapp` |
| `120363...@g.us`, `group:abc` | `group:...` | `other` |
| `98765@lid`, anything else unrecognised | `other:<lowercase>` | `other` |
| empty, too short, `a@b` | `null` | |

- Numbers without a country code use the default region (`REPLY_CORE_DEFAULT_REGION`, default `HU`); a number is accepted if libphonenumber considers it *possible*. Extensions (`ext. 12`, `x12`) are dropped.
- Email local parts are lowercased but Gmail dots and `+tags` are **not** altered.
- A WhatsApp number is a different handle from the same phone number on iMessage (`+36301234567@wa` vs `+36301234567`). They share a contact only through the address book or an explicit merge. The Contacts connector links both forms for every phone number in the address book, because that is the user's own data.
- Changing the default region does not rewrite handles already stored.

`formatHandle(handle_norm)` gives the display form (international phone format; `(WhatsApp)` suffix for WhatsApp).

## Merge and unmerge

`POST /api/contacts/:id/merge` with `{ "sourceContactId": "..." }` moves every handle of the source into `:id`:

```json
{ "mergeLogId": "m_...", "movedHandles": ["+36301234567@wa"], "movedMessages": 412, "targetContactId": "c_..." }
```

The source contact is kept but hidden (`hidden = 1`, `merged_into = target`) so it can be restored. Messages are not rewritten: they follow their handle. Both summaries are rebuilt in the same transaction.

`POST /api/contacts/:id/unmerge` with `{ "mergeLogId": "..." }` restores exactly the handles recorded in that entry to the original contact, with their previous link origin, even if new messages arrived meanwhile (they follow the handle). Response: `{ "restoredContactId": "...", "restoredHandles": [...] }`.

`GET /api/contacts/:id/merges` lists merges and unmerges involving the contact, newest first: `{ items: [{ id, ts, action, fromName, toName, handlesCount, revertedBy? }] }`.

| Status | `code` | When |
|---|---|---|
| 400 | `invalid_request` | bad body |
| 400 | `cannot_merge_self` | source equals target |
| 404 | `contact_not_found` | unknown contact, or a contact already merged away (as source or target), or an unknown contact for history |
| 404 | `merge_not_found` | unknown or non-merge log id |
| 409 | `merge_already_reverted` | the merge was already undone |
| 409 | `handle_conflict` | a handle of the merge was moved again since; `error.details.handles` lists them |

**Chains** must be undone in reverse order: after A is merged into B and B into C, undo B into C first. Undoing A into B first returns `handle_conflict`.

## Address-book import

`identity.importContacts(people)` (used by the Contacts connector) takes `[{ externalId, displayName, handles: [{ handle_norm, kind }] }]` and returns `{ created, updated, linked, conflicts, protectedByMerge }`:

- a person is identified by `externalId` (`contacts.external_id`); a changed name is updated;
- a handle with no link, or an `auto` link, is linked to the person (`link_origin = apple_contacts`); an emptied `auto` contact is deleted;
- a handle already linked to a **different** address-book person is reported in `conflicts` and left alone (for example two people sharing a landline);
- a handle linked by a manual merge is left alone and counted in `protectedByMerge`;
- importing the same list twice changes nothing.

## Recovery

With the service stopped: `node core/scripts/identity-reset.js --to-auto` undoes every manual merge. Handles go back to the address-book person they came from, or to fresh `auto` contacts. Messages and the merge log are untouched.

## Data

Migration `0003_identity.sql` adds `contacts.external_id` (unique when set) and `contacts.merged_into`. `merge_log.handles_json` is a JSON array of `{ handle_norm, prior_origin }`. See [CORE_DATA_MODEL.md](CORE_DATA_MODEL.md).
