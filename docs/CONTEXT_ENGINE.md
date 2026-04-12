# {reply} — Context engine

The **context engine** (`chat/context-engine.js`) builds the prompt bundle for local reply generation: identity/KYC, tone/style profile, **recipient-scoped** conversation history, hybrid RAG “facts”, and golden examples. `chat/reply-engine.js` calls `assembleReplyContext(message, handle)` for each suggestion.

## Recipient awareness

- **Identity:** `contactStore.getProfileContext(recipient)` when a handle is known.
- **Relationship tone:** Adjusts system instructions (professional vs casual) from the contact record.
- **Thread history:** Resolves all channel prefixes for the contact (`pathPrefixesForHandle`), loads `getHistory` for each, dedupes, then takes the last **10** messages in chronological order. Each line is passed through **`enrichAnnotatedDocText`** so Ollama annotation (tags, summary, facts) is visible in the thread block, not only in the RAG facts section.
- **Past interactions block** (in `getContext`): Recent snippets from `getSnippets` are also enriched before clipping for the prompt.

## Voice → composer (voice-to-draft)

The hub exposes **Mic** (`#btn-mic` in `chat/index.html`) when a conversation is open. The client uses the **Web Speech API** (`webkitSpeechRecognition` / `SpeechRecognition`) in `chat/js/app.js`: interim and final transcripts are appended to `#chat-input`. From there, use **Suggest** (`/api/suggest`) or edit manually before send. No server-side audio storage.

**Requirements:** Chromium/Safari-class browsers with microphone permission; language follows `navigator.language` on the recognition instance.

## Related docs

- [INGESTION.md](INGESTION.md) — data in LanceDB and optional annotation.
- [README.md](../README.md) — product overview and version.
