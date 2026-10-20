# Channel Integration Case Study — OpenClaw WhatsApp Pattern

This document captures the production pattern used to integrate WhatsApp via OpenClaw into `{reply}` with strict human-final-decision controls. Use this as the template for all future channels.

## Goal

- Inbound channel events flow into `{reply}` as draft/context signals.
- Outbound messages are sent only from `{reply}` UI after explicit human action (`Enter`/`Send`).
- No autonomous channel-side bot messaging to contacts.

## Final architecture (reference implementation)

1. OpenClaw handles channel transport and session state.
2. `{reply}` remains policy authority for outbound execution.
3. `{reply}` API route enforces:
- operator token
- human approval
- manual UI source
- fresh `human_enter` trigger
4. OpenClaw channel policy is forced to no-contact-bot mode on startup and before each send.

## Security and policy controls

### 1) Manual-only outbound in `{reply}`

Route: `/api/send-whatsapp`

Required:
- `approval.source` in approved UI values
- `trigger.kind = human_enter`
- `trigger.at` fresh (2-minute validity)
- valid operator token and human approval signal

Denied otherwise (`403`) with explicit policy codes:
- `manual_ui_send_required`
- `human_enter_trigger_required`
- `openclaw_whatsapp_send_disabled` (if policy toggle is off)

### 2) OpenClaw anti-autonomous guard

Guard module: `chat/openclaw-guard.js`

Enforced:
- `channels.whatsapp.dmPolicy = disabled`
- `channels.whatsapp.accounts.default.dmPolicy = disabled`
- `channels.whatsapp.groupPolicy = allowlist`
- `channels.whatsapp.accounts.default.groupPolicy = allowlist`
- `~/.openclaw/credentials/whatsapp-allowFrom.json` reset to:

```json
{
  "version": 1,
  "allowFrom": []
}
```

### 3) Deterministic environment loading

`chat/server.js` loads `chat/.env` by absolute module path (`__dirname`) so policy flags are applied regardless of launch directory.

## Runtime configuration used

In `chat/.env`:

```dotenv
REPLY_WHATSAPP_SEND_TRANSPORT=openclaw_cli
REPLY_WHATSAPP_ALLOW_OPENCLAW_SEND=true
REPLY_WHATSAPP_DESKTOP_FALLBACK_ON_OPENCLAW_FAILURE=false
```

## UI contract used

Frontend send path (`chat/js/api.js`) includes:
- `approval.source = "ui-send-message"`
- `trigger = { kind: "human_enter", at: ISO_TIMESTAMP }`
- For WhatsApp: `transport = "openclaw_cli"`
- For WhatsApp: `allowDesktopFallback = false`

This guarantees outbound goes through the hardened OpenClaw path only when a human explicitly sends.

## Validation checklist (must pass before enabling any channel)

1. Static checks
- `node chat/security-audit.js`
- `node chat/security-audit.js --fix`
- `node --check chat/server.js`

2. Policy checks (API)
- Send without trigger -> `403 human_enter_trigger_required`
- Send with trigger (`dryRun=true`) -> `200`, `transport=openclaw_cli`

3. OpenClaw config checks
- `openclaw config get channels.<channel>.dmPolicy` is `disabled` for bot DM channels
- per-account DM policy also `disabled`
- allowFrom list empty (or explicit allowlist you control)

4. Live send checks
- message only leaves when initiated from `{reply}` UI send action
- inbound contact message does not trigger channel-side auto-response

## Incident that drove this pattern

Observed failure: OpenClaw sent pairing/access prompts into partner chats when inbound contact messages arrived.

Root cause:
- Channel DM policy allowed pairing flow to contact-side DM path.

Mitigation:
- force DM policy `disabled`
- clear allowFrom
- reassert guard at startup and before send
- keep outbound authority in `{reply}` with explicit human trigger

## Reuse blueprint for future channels

For each new channel (Telegram, Discord, Signal, Viber, LinkedIn, etc.):

1. Add a `<channel>-guard` policy mapping in `openclaw-guard.js`.
2. Add route-level gate in `{reply}` send endpoint:
- manual UI source only
- `human_enter` freshness window
- operator token + human approval
3. Keep channel in draft-only until dry-run + live checks pass.
4. Add explicit rollout flag in Settings (`draft_only`/`disabled`/`send_enabled` when applicable).
5. Add release note entry and SSOT board issue updates.

## Non-negotiable rule

No channel is allowed to autonomously message external contacts.  
All outbound communication must originate from `{reply}` UI and be finalized by human action.
