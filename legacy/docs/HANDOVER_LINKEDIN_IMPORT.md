# Handover: LinkedIn Data Archive Import

## Overview
This sub-project adds the ability to import historical LinkedIn messages from a `messages.csv` file (obtained via LinkedIn's self-service Data Archive export) into the {reply} local brain.

## Current State: ✅ READY (Waiting for Data)
The feature is fully implemented, verified with test data, and merged into the main codebase.

### Waiting for User Action
- [ ] User needs to download and extract their LinkedIn Data Archive.
- [ ] Locate `messages.csv` in the extracted ZIP.
- [ ] Upload via the {reply} Dashboard.

## Key Components

### 1. Backend API (`chat/server.js`)
- **Endpoint**: `POST /api/import/linkedin`
- **Logic**: Receives raw CSV text, parses it using a custom character-by-character CSV parser (to handle newlines inside quoted fields), maps LinkedIn fields to the `InboundEvent` format, and ingests them into LanceDB via `ingestInboundEvents`.
- **Security**: Requires local access (loopback) OR the `X-Reply-Human-Approval: confirmed` header.

### 2. Frontend (`chat/js/dashboard.js`)
- **UI**: Added a custom LinkedIn card in the dashboard with an "📥 Import Archive" button.
- **Handler**: `handleLinkedInImport()` manages the file selection, reads the file as text, and sends it to the server with a progress indicator.

### 3. CSV Parsing (`chat/server.js` - `parseLinkedInCSV`)
- A robust CSV parser that correctly handles the specific LinkedIn format: `FROM,TO,DATE,SUBJECT,CONTENT,DIRECTION,FOLDER`.

## Important Decision: Why CSV and not API?
LinkedIn's official OAuth App permission model (the "Permitted Services" like Kilo Code) **does not** grant access to personal messages. Messaging APIs are restricted to enterprise partners (typically for business hiring or ad-tech). 

**Result**: The CSV export is the only viable path for personal message history portability.

## Verification
Verified with a 3-row sample:
```bash
curl -X POST http://localhost:3001/api/import/linkedin \
  -H "Content-Type: text/csv" \
  -H "X-Reply-Human-Approval: confirmed" \
  --data-binary @messages.csv
```
Expected output: `{"status":"ok","count":3,"errors":0,"message":"Imported 3 messages."}`
