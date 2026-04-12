# {reply} ↔ {hatori} — Sensitivity & redaction API contract (reply#16)

This document captures the **cross-system contract** for PII, redaction, and safe display when `{reply}` exchanges data with `{hatori}`. It implements the **acceptance criteria** from [reply#16](https://github.com/moldovancsaba/reply/issues/16): documented options, downstream dependencies, chosen migration path, and follow-up work.

---

## Problem statement

If `{hatori}` classifies or redacts PII, every integrator must know:

| Concern | Question |
| :--- | :--- |
| Raw vs redacted | Which fields may contain verbatim PII? |
| Display safety | What may appear in operator UI vs logs? |
| Indexing | What may be embedded in LanceDB / RAG prompts? |
| Channel scope | Which identifiers must stay within a channel boundary? |
| Identity linking | How do we link contacts without leaking raw IDs across channels? |

---

## Contract options (design space)

### Option 1 — Implicit (status quo)

- **Behavior:** `{hatori}` may redact internally; payloads stay unstructured; `{reply}` assumes “mostly safe” text.
- **Pros:** No schema churn.
- **Cons:** Hidden behavior; ambiguous indexing and UI; hard to audit.

### Option 2 — Explicit sensitivity metadata (recommended near term)

- **Behavior:** Each payload (or selected fields) carries a small **`SensitivityMeta`** object describing class, redaction level, and indexing policy.
- **Pros:** Clear contract; incremental adoption; works with existing single-body JSON.
- **Cons:** Every producer/consumer must set and honor metadata.

### Option 3 — Split payloads (`raw` / `display` / `index`)

- **Behavior:** Separate blobs: internal pipeline uses `raw`; UI uses `display`; RAG uses `index` (possibly hashed tokens).
- **Pros:** Strongest boundary; clearest compliance story.
- **Cons:** Larger API and storage migration.

---

## Recommendation & migration strategy

1. **Adopt option 2 first**, design fields so they can map cleanly to option 3 later (`payload_class` ≈ which blob would apply).
2. **Phase A (documentation + types):** JSDoc / OpenAPI-style typedefs in `{reply}` (`hatori-client.js`) and mirrored in `{hatori}` OpenAPI — no breaking changes.
3. **Phase B (write path):** `{reply}` injects **`metadata.sensitivity`** on `ingestEvent` / `getResponse` via `chat/hatori-client.js` (`defaultSensitivityMeta` / `mergeMetadataSensitivity`). Callers may override fields; unknown keys should be ignored by `{hatori}` until it adopts the contract.
4. **Phase C (read path):** UI and LanceDB ingestion branches on `safe_to_index` and `payload_class`.
5. **Phase D (option 3):** Introduce parallel `display_body` / `index_body` only where audits require it.

**Follow-up implementation cards (suggested)**

- `{hatori}`: accept optional `SensitivityMeta` on draft + thread APIs; echo + refine on responses.
- `{reply}`: map `message-store` / bridge events → metadata; strip non-indexable fields before `vector-store.addDocuments`.
- `{reply}` UI: badge “redacted” / disable copy on `payload_class !== 'display_safe'`.
- **Alias model:** keep using opaque `reply:`-prefixed IDs in `{hatori}` metadata; resolve PII in `{reply}` only ([reply#19](https://github.com/moldovancsaba/reply/issues/19)).

---

## `SensitivityMeta` (option 2 shape)

Stable keys (string enums / booleans):

| Field | Type | Meaning |
| :--- | :--- | :--- |
| `payload_class` | `raw` \| `redacted` \| `display_safe` | Trust level of paired text |
| `pii_classes` | string[] | e.g. `email`, `phone`, `iban` — informational |
| `safe_to_index` | boolean | If false, must not land in LanceDB / RAG |
| `channel_scoped_ids` | boolean | If true, IDs must not be joined across channels |

**Downstream dependencies:** `chat/hatori-client.js`, `chat/routes/messaging.js`, `chat/vector-store.js`, `chat/js/messages.js`, `{hatori}` FastAPI routes under `/v1/`.

---

## Related issues & docs

- [reply#19](https://github.com/moldovancsaba/reply/issues/19) — reversible alias merge (identifier hygiene).
- [INGESTION.md](INGESTION.md) — what gets vectorized today.
