# OpenClaw Playbook

This playbook documents the architecture, state locations, and common troubleshooting steps for the local `OpenClaw` integration with `Reply`. Future developers (or AI agents) should consult this document before attempting to debug OpenClaw connectivity issues.

## 1. Architecture Overview

- **OpenClaw CLI (`openclaw`)**: The command-line interface used to manage the gateway, channels, and agent configuration.
- **Gateway Daemon (ws://127.0.0.1:18789)**: The background Local WebSocket server (managed by macOS `launchd`). It holds the active WhatsApp connection and routes agent executions.
- **Browser Sidecar (http://127.0.0.1:18791)**: An isolated Chromium instance spawned by OpenClaw to handle Canvas and specialized web automations.
- **`{reply}` Backend (`server.js`)**: Communicates with the OpenClaw Gateway to send/receive WhatsApp messages. It executes `openclaw message send --json` under the hood for outbound transmission.

## 2. State & Configuration Locations

- **Base Directory**: `~/.openclaw`
- **Configuration File**: `~/.openclaw/openclaw.json` (Stores the `gateway.auth.token` and channel policies).
- **Credentials Directory**: `~/.openclaw/credentials/` (Must be secured with `chmod 700`. Contains session tokens and allowlists).
- **Agent Workspace**: `~/.openclaw/workspace/` (Active agent memory and sessions).
- **Logs**: `~/.openclaw/logs/` (Gateway logs a highly detailed text stream here).

## 3. Common Errors & Fixes

### A. The "Bind: loopback" Error (Node.js Execution Failure)
**Symptom**: `server.js` throws an exception when sending a WhatsApp message:
> `Failed to send message: too many arguments for 'send'` or `Bind: loopback`

**Root Cause**: When `reply` executes `openclaw message send --json`, the OpenClaw CLI may print Security Audit warnings (e.g., `WARN gateway.bind is loopback` or `WARN Reverse proxy headers`) to `stderr`. Naive error parsing in `server.js` treats any `stderr` output as a fatal error string, masking the true CLI error.
**Fix Applied**: `server.js` has been updated to filter out `WARN` and `gateway.bind` lines from `stderr` before throwing exceptions.
**Recovery**: If it happens again, verify that `sendWhatsAppViaOpenClawCli` in `server.js` is properly filtering `stderr` output.

### B. The "Token Mismatch" or "Token Missing" Error (Browser Dashboard)
**Symptom**: Opening the Control UI (`http://127.0.0.1:18789/overview`) in a browser returns `unauthorized: gateway token missing` or `gateway token mismatch`.
**Root Cause**: The gateway regenerates its authentication token upon a fresh setup. The web browser caches the *old* token in LocalStorage, specifically attached to the exact hostname (`127.0.0.1` vs `localhost`).
**Fix Applied**: Navigating to the page with `#token=<NEW_TOKEN>` forces LocalStorage to update. 
**Recovery**: 
1. Run `openclaw dashboard --no-open` to get the fresh tokenized URL.
2. Paste that URL directly into the browser to overwrite LocalStorage.

## 4. The "Nuclear Option" (Complete Rebuild)

If the gateway state becomes irrevocably corrupted or channels refuse to link, perform a clean teardown and rebuild:

1. **Wipe State**:
   ```bash
   openclaw uninstall --service --state --workspace --non-interactive --yes
   ```
2. **Reconfigure**:
   ```bash
   openclaw setup --non-interactive
   openclaw onboard --non-interactive --accept-risk
   ```
3. **Secure Credentials**:
   ```bash
   mkdir -p ~/.openclaw/credentials && chmod 700 ~/.openclaw/credentials
   ```
4. **Start Gateway**:
   ```bash
   openclaw gateway install
   openclaw gateway start
   ```
5. **Relink Channels**:
   ```bash
   openclaw channels login --channel whatsapp
   ```
6. **Fetch New Dashboard Link**:
   ```bash
   openclaw dashboard --no-open
   ```
