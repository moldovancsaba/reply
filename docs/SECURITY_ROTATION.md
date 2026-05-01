# Credential rotation — `{reply}`

This document supports [reply#34](https://github.com/moldovancsaba/reply/issues/34) and the historical note in [`HANDOVER.md`](HANDOVER.md): `.env` was once tracked; **any secret that ever appeared in Git history must be treated as compromised** until rotated.

Rotating real keys is **operator work** (the repository cannot perform it for you). This file is the **repeatable procedure** and the place to record **when** rotation was completed (redacted evidence only).

## 1. Inventory (what to rotate)

Typical `{reply}` secrets (names may vary by install):

| Secret / setting | Where it lives | Action |
|------------------|----------------|--------|
| `REPLY_OPERATOR_TOKEN` | `chat/.env` | Generate a new random token; update `.env` on every machine that calls sensitive routes. |
| `GOOGLE_API_KEY` / Gmail OAuth | `chat/.env`, Google Cloud Console | Revoke old key or rotate OAuth client; reconnect Gmail in Settings if needed. |
| Gmail refresh token | `chat/data/settings.json` (or Settings UI) | Use Settings disconnect/reconnect after client secret rotation. |
| Any third-party API keys | `.env` / settings | Rotate at the provider; update local `.env` only (never commit). |

Search hints (local clone):

```bash
git log -p --all -S 'REPLY_OPERATOR_TOKEN' -- chat . | head
git log -p --all -S 'GOOGLE_API_KEY' -- chat . | head
```

## 2. Rotation checklist

1. Generate new operator token (long random string); set `REPLY_OPERATOR_TOKEN` in `chat/.env` on the Mac(s) that run the hub.
2. If Gmail keys were exposed: create new key or OAuth client in Google Cloud; update `.env`; use Settings to disconnect and reconnect Gmail.
3. Restart the hub (`make stop` / `make run`) so the process picks up new env.
4. Confirm sensitive routes still work: `POST /api/settings` with new token + approval headers (see `docs/HUMAN_FINAL_DECISION_POLICY.md`).
5. Optional but recommended: enable **GitHub secret scanning** and **push protection** on `moldovancsaba/reply` (repository **Settings → Code security**).

## 3. Evidence (fill after you rotate)

Record here **after** rotation (no live secrets):

| Item | Rotated (Y/N) | Date (UTC) | Notes |
|------|---------------|------------|--------|
| `REPLY_OPERATOR_TOKEN` | | | e.g. “new token in 1Password” |
| Google / Gmail credentials | | | e.g. “new API key v2, old revoked” |
| Other (list) | | | |

When the table is complete, close or update [reply#34](https://github.com/moldovancsaba/reply/issues/34) with a short comment pointing to this section (still redacted).

### 3b. Repository / product prevention (no provider credentials)

Track **code and policy** controls that reduce future leakage and support audits. These do **not** replace provider key rotation in §3.

| Control | Done (Y/N) | Date (UTC) | Notes |
|---------|------------|------------|--------|
| Default path: no operator token fragments written to `debug_token.log` | Y | 2026-04-12 | Gated by `REPLY_DEBUG_SETTINGS` (reply#32); file gitignored |
| `chat/data` created with strict mode where applicable | Y | 2026-04-12 | `status-manager`, `settings-store`, `security-policy`, etc. |
| `npm test` + `npm run lint` on `main` | Y | 2026-04-12 | CI: `.github/workflows/ci.yml` |
| `node chat/security-audit.js` clean on maintained installs | Y | 2026-04-12 | Run after `security-audit.js --fix` if data dir was loose |

## 4. Prevention

- Never commit `chat/.env` (see `.gitignore`).
- Prefer `chat/.env.example` with **placeholders only**.
- CI runs `npm audit --audit-level=high` as an informational step (see `.github/workflows/ci.yml`); tighten policy if noise is acceptable.
