# Reply — First functions (POC scope)

**Source of truth is the [MVP Factory Board](https://github.com/users/moldovancsaba/projects/1).** This doc captures the first capabilities Reply will deliver for the initial POC so the project can be tested end-to-end.

---

## 1. Knowledge injection — “annotate how I act”

Reply should be able to ingest and use your existing data so it can mirror **what you do** and **how you act** (tone, style, decisions) when suggesting replies.

**Target sources (POC and beyond):**

| Source | Description |
|--------|-------------|
| **Gmail** | Old emails (sent and received) to learn phrasing, tone, and how you respond to common situations. |
| **Google Drive** | Documents you write or comment on — style and terminology. |
| **iCloud** | Files and notes in iCloud (e.g. iCloud Drive, Notes) — how you structure and phrase things. |
| **Apple Notes** | Notes content and structure — vocabulary and priorities. |
| **Calendar events** | Event titles, descriptions, and context — how you describe meetings and commitments. |
| **Other local/online** | Local files (e.g. markdown, text), other cloud docs or feeds as needed. |

**POC goal:** Design a small “knowledge” model (what we store, how we index it) and implement ingestion for **at least one source** (e.g. local text/markdown files or one API like Gmail) so the system can be annotated with “how I act” and used when generating reply suggestions.

---

## 2. Simple chat window on localhost — “ask for replies in the chat”

A minimal way to use Reply during the POC:

- **Browser-based chat** served on **localhost** (no public deployment).
- User opens the app in the browser, types or pastes a message (e.g. an email or message they received).
- User asks Reply for **suggested replies** (e.g. “Suggest a reply” or “How would I answer this?”).
- Reply returns one or more suggested replies in the chat, using:
  - Only rule-based logic at first, or
  - Ingested knowledge (once available) to match the user’s style and context.

**POC goal:** Implement a simple chat UI on localhost where the user can ask for reply suggestions and see answers in the chat. No login or messaging integrations required for the first POC.

---

## Summary — POC first functions

| # | Function | POC deliverable |
|---|----------|-----------------|
| 1 | **Knowledge injection** | Design + at least one pipeline (e.g. Gmail or local files) to ingest and annotate “how I act”; data available for the reply engine. |
| 2 | **Localhost chat** | Browser UI on localhost: user can paste/type a message and ask for reply suggestions; suggestions shown in the chat. |

Together these allow testing the project end-to-end: inject some knowledge, open the chat, ask for a reply, and verify that the system can use the injected context (once wired) and deliver a usable suggestion.
