# Channel Bridge (Inbound, Draft-First)

**Doc freshness:** 2026-05-20

`{reply}` exposes a local inbound bridge route for external sidecars (for example OpenClaw adapters) to normalize omnichannel events into the local memory store.

## Endpoint

- `POST /api/channel-bridge/inbound`
- Local-only route. Depending on the active security policy, it may require the operator token / protected-route headers.
- Human approval is not required for inbound ingestion.
- Supports single-event payloads, JSON arrays, or `{ "events": [...] }`.
- `GET /api/channel-bridge/events?limit=50` returns recent immutable bridge event records.
- `GET /api/channel-bridge/summary?limit=200` returns aggregated bridge health counters and rollout modes.

## Rollout flags (server-enforced)

Bridge ingress is controlled per channel in settings:

```json
{
  "channelBridge": {
    "channels": {
      "telegram": { "inboundMode": "draft_only" },
      "discord": { "inboundMode": "draft_only" },
      "signal": { "inboundMode": "draft_only" },
      "viber": { "inboundMode": "draft_only" },
      "linkedin": { "inboundMode": "draft_only" }
    }
  }
}
```

Modes:
- `draft_only`: inbound ingest allowed
- `disabled`: inbound ingest blocked (`403`, `code=channel_bridge_disabled`)

Current bridge-managed channels:
- `telegram`
- `discord`
- `signal`
- `viber`
- `linkedin`

### Common headers

- `Content-Type: application/json`
- `X-Reply-Operator-Token: <REPLY_OPERATOR_TOKEN>` when the active security policy requires it

## Inbound payload contract

```json
{
  "channel": "telegram",
  "peer": {
    "id": "u-123",
    "handle": "@alice",
    "displayName": "Alice"
  },
  "messageId": "tg-1708250000-1",
  "text": "Hi from Telegram",
  "timestamp": "2026-02-18T11:02:00Z",
  "attachments": [
    {
      "id": "a1",
      "type": "image",
      "name": "photo.png",
      "url": "https://example.com/photo.png",
      "mimeType": "image/png",
      "size": 12345
    }
  ]
}
```

Notes:
- At least one of `text` or `attachments` must be present.
- `messageId` and `timestamp` are normalized server-side if omitted or malformed.
- `dryRun: true` can be included to validate normalization without writes.
- Retries are safe: ingest is idempotent by stable bridge document id; duplicate events are skipped.
- Seen bridge ids are persisted locally in `~/Library/Application Support/reply/channel_bridge_seen.json` for restart-safe dedupe.

## Behavior

On success, the server:
- normalizes the event to `{channel, peer, messageId, text, timestamp, attachments}`
- stores a document in LanceDB (`documents` table)
- attempts a bounded `chat.db` write for `unified_messages`
- updates `contact-store` last-contacted metadata asynchronously
- invalidates conversation caches for immediate UI visibility

If `chat.db` is busy:

- the bridge does not keep the HTTP request open indefinitely
- the message is queued in `~/Library/Application Support/reply/channel_bridge_pending.json`
- the background worker replays queued bridge writes under a dedicated outbox lock
- replay reconciles against `unified_messages` before retrying, so already-persisted messages are removed from the queue cleanly

For duplicate retries:
- response status is `duplicate` (single event) or includes `skipped` count (batch).

For batch requests:
- response includes `accepted`, `skipped`, `errors`, `total`, and per-item `results`.

## Lineage log

- Recent bridge ingest decisions are appended to:
  - `~/Library/Application Support/reply/channel_bridge_events.jsonl`
- Each row includes status (`ingested`, `duplicate`, `error`), channel, message id, peer, and doc metadata.
- Additional replay statuses now include:
  - `queued_persistence`
  - `pending_retry`
  - `pending_drained`
  - `pending_reconciled`

## Summary response

`/api/channel-bridge/summary` returns:
- recent count totals (`ingested`, `duplicate`, `error`, `other`, `total`)
- per-channel counters
- rollout modes (`telegram`, `discord`, `signal`, `viber`, `linkedin`)
- last event timestamp and last error timestamp

## Local sidecar CLI helper

Use the helper script to forward JSON/NDJSON/array payloads:

```bash
cd /Users/Shared/Projects/reply/chat
npm run channel-bridge:ingest -- --event '{"channel":"telegram","peer":{"handle":"@alice"},"text":"hello","timestamp":"2026-02-18T11:02:00Z"}'
```

Dry-run:

```bash
npm run channel-bridge:ingest -- --event '{"channel":"discord","peer":{"handle":"alice#1234"},"text":"draft check"}' --dry-run
```

```bash
npm run channel-bridge:ingest -- --event '{"channel":"signal","peer":{"handle":"+15555550123"},"text":"hello from signal"}' --dry-run
```

Batch mode:

```bash
cat events.ndjson | npm run channel-bridge:ingest -- --batch
```

## Outbound Safety

Bridge channels are inbound + draft-first in `{reply}`. Outbound send remains blocked in the composer for:
- Telegram
- Discord
- Signal
- Viber

LinkedIn is the exception:

- LinkedIn uses the same inbound bridge architecture for ingest
- outbound LinkedIn handoff exists in the product, but it is not the same thing as enabling outbound send for the generic bridge-managed channels

## Implementation Reference

For reusable rollout and hardening steps (human-enter gating, OpenClaw DM guard, validation matrix), use:
- `docs/CHANNEL_INTEGRATION_CASE_STUDY.md`
