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

### C. Docker `openclaw-gateway` restart loop (`allowedOrigins` / empty config)

**Symptom:** `docker logs openclaw-gateway` repeats:

> `Gateway failed to start: Error: non-loopback Control UI requires gateway.controlUi.allowedOrigins …`

**Common causes:**

1. **`gateway.controlUi.allowedOrigins` missing** while the process is started with a **non-loopback bind** (for example Docker Compose using `gateway --bind lan`). Fix: add `gateway.controlUi.allowedOrigins` in the mounted `openclaw.json` (include at least `http://127.0.0.1:18789` and `http://localhost:18789`), or follow OpenClaw’s documented `dangerouslyAllowHostHeaderOriginFallback` option if appropriate for your threat model.

2. **Bind mount looks empty inside the container** (`docker exec … ls /home/node/.openclaw` shows almost nothing). On **Docker Desktop for Mac**, directories under **`/Users/Shared/...`** are often **not shared** with the Linux VM, so the mount appears empty and OpenClaw never sees your real `openclaw.json`. Fix: either add **`/Users/Shared`** under **Docker Desktop → Settings → Resources → File sharing**, or set **`OPENCLAW_HOST_CONFIG_DIR`** in **`mvp-factory-control/.env`** to a **copy** of `openclaw_config` under your home directory (for example `~/.mvp-factory/openclaw_config`) and point Compose at that path (see `mvp-factory-control/docker-compose.yml`).

3. **Port `18789` already in use on the Mac** (for example another process or an SSH remote forward). Fix: stop the conflicting listener, or map a different **host** port to container **`18789`** (for example **`CLAWDBOT_GATEWAY_PORT=18790`** with **`18790:18789`** in Compose) and set **`REPLY_OPENCLAW_GATEWAY_URL=ws://127.0.0.1:18790`** plus **`REPLY_OPENCLAW_GATEWAY_TOKEN`** in **`chat/.env.local`** (see **`chat/openclaw-gateway-env.js`**).

4. **Gateway never binds / `healthz` refuses inside the container** while **`OPENAI_API_BASE`** points at **`host.docker.internal:11434`**. If Ollama on the host is down, slow, or unreachable from Docker, OpenClaw can sit at high CPU before listening. Fix: start Ollama on the Mac, or remove **`OPENAI_API_BASE`** from the **`openclaw-gateway`** service until the model host is reliable (see **`mvp-factory-control/docker-compose.yml`** comments).

5. **`openclaw gateway health` reports `pairing required` (1008)** while **`curl http://127.0.0.1:18789/healthz`** returns **`{"ok":true}`**. The WS health path can require pairing even when the HTTP health endpoint is fine. **`{reply}`** probes **`http://…/healthz`** when **`REPLY_OPENCLAW_GATEWAY_URL`** is **`ws://` / `wss://`** so **`/api/health`** and **`/api/openclaw/status`** stay accurate for Docker gateways.

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
