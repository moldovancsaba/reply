# Reply Core Drafting

Status: living document, owned by issue #204; the draft panel (#207) is its first user.

Drafting is **optional and off by default**. When enabled, Reply Core sends the last messages with one contact to a **local** model (Ollama) in a single request and returns one proposed reply. A person reviews and edits it; Reply Core never sends it, stores it, or learns from it.

## Turning it on

```bash
ollama pull llama3.1:8b          # or any model you prefer
REPLY_CORE_LLM=ollama REPLY_CORE_OLLAMA_MODEL=llama3.1:8b npm start
```

| Variable | Default | Meaning |
|---|---|---|
| `REPLY_CORE_LLM` | `off` | `off` or `ollama` |
| `REPLY_CORE_OLLAMA_MODEL` | none | required when `ollama` |
| `REPLY_CORE_OLLAMA_URL` | `http://127.0.0.1:11434` | where Ollama listens |
| `REPLY_CORE_ALLOW_REMOTE_LLM` | unset | set to `1` to allow a URL that is not on this machine |

**Privacy.** The service refuses to start if the URL is not loopback (`127.0.0.1`, `localhost`, `::1`) unless `REPLY_CORE_ALLOW_REMOTE_LLM=1` is set. A remote model means conversation text leaves this Mac; that must be a deliberate decision. There is no cloud provider in Reply Core.

## Endpoints

`GET /api/drafts/capabilities` tells the UI whether to offer drafting, without making a model call (cached 10 s):

```json
{ "enabled": true, "provider": "ollama", "model": "llama3.1:8b" }
{ "enabled": false, "provider": "off", "reason": "not_configured" }
{ "enabled": false, "provider": "ollama", "model": "llama3.1:8b", "reason": "model_missing" }
{ "enabled": false, "provider": "ollama", "model": "llama3.1:8b", "reason": "unreachable" }
```

`POST /api/drafts/suggest`:

```json
{ "contactId": "c_1", "channel": "imessage", "instruction": "say yes, ask for the address" }
```

```json
{ "draft": "Yes, 6 works. Where should we meet?", "provider": "ollama", "model": "llama3.1:8b", "contextMessages": 20, "truncated": false }
```

`instruction` is optional (max 300 characters). Any other key is `400 invalid_request`.

| Status | `code` | `retryable` | The message the UI shows |
|---|---|---|---|
| 409 | `drafting_disabled` | no | Drafting is turned off. Enable a local model to use it. |
| 503 | `model_unavailable` | yes | The local model is not reachable. Start Ollama and try again. (A missing model says: `ollama pull <model>`, not retryable.) |
| 504 | `draft_timeout` | yes | The model took too long. Try again or write the reply yourself. |
| 422 | `empty_draft` | no | The model returned nothing. Try again. |
| 429 | `draft_busy` | yes | A draft is already being written. |
| 404 | `contact_not_found` | no | unknown or merged-away contact (`details.mergedInto`) |
| 400 | `invalid_request` | no | bad channel, bad instruction, unknown key |

## What the model sees

One prompt, built from the contact's thread across all channels: the last **20 messages**, at most **6,000 characters** in total (oldest dropped first), each message cut to **600 characters**, one line per message in the form `[channel me|them time] text`. `truncated` is true when anything was cut. A contact with no messages is allowed.

The conversation is wrapped in `<messages>` and introduced as data, not instructions; the model has no tools and no way to act. Text inside a message that tries to give it instructions can at most influence the draft, which a human must read before anything is sent. The answer is cleaned (a leading label or surrounding quotes removed) and capped at 1,200 characters.

## Limits and failure behaviour

- One draft at a time, for the whole service (`429 draft_busy` otherwise).
- 30 s deadline per request; a timeout is **not** retried (that would only double the wait). A refused connection is retried once after 500 ms.
- A client that disconnects cancels the model call.
- Nothing is persisted: no prompt, no draft, no history.
- Logs carry the contact id, the number of context messages, the duration and the outcome. Never text.

## Disabling

`REPLY_CORE_LLM=off` (or unset) turns it off at the next start. No data or schema is involved.
