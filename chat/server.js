/**
 * {reply} hub — HTTP API + static UI for the local chat / sync surface.
 *
 * Routing lives under `routes/*` (messaging, sync, system, …). Managed children (worker,
 * optional Hatori) go through `service-manager.js`. Before starting the worker, the hub calls
 * `ensure-hub-worker.js` so a stale `data/worker.pid` or duplicate worker does not exit 0
 * immediately. `hub-runtime.js` records the bound port for `/api/health` (`httpPort`/`httpHost`).
 *
 * Shutdown: `SIGINT` / `SIGTERM` trigger `gracefulShutdown()` → `serviceManager.shutdownAllAsync()`
 * then `server.close()` (see bottom of this file).
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { loadReplyEnv } = require("./load-env.js");
loadReplyEnv();

const HATORI_PROJECT_PATH = path.join(__dirname, "..", "..", "hatori");
if (String(process.env.REPLY_USE_HATORI || "").trim() === "1") {
  if (!fs.existsSync(HATORI_PROJECT_PATH)) {
    console.warn(
      `[Hatori] REPLY_USE_HATORI=1 but no checkout at ${HATORI_PROJECT_PATH} — hub will not spawn the sidecar. Clone https://github.com/moldovancsaba/hatori as a sibling of this repo, or set REPLY_HATORI_EXTERNAL=1 if the API already runs elsewhere.`
    );
  }
}

/** Verbose hub `console.log` lines (reply#33). Errors/warnings stay on. */
function replyHubDebugLog(...args) {
    const v = String(process.env.REPLY_DEBUG || "").trim().toLowerCase();
    if (v === "1" || v === "true" || v === "yes") {
        console.log(...args);
    }
}

// Utilities & Middleware
const { writeJson } = require("./utils/server-utils.js");
const securityMiddleware = require("./middleware/security.js");
const statusManager = require("./status-manager");

// 0. Initial Status: Loading
statusManager.update("system", { status: "loading", progress: 10, message: "Initializing hub..." });
const { getSecurityPolicy } = require("./security-policy.js");
const {
  syncWhatsApp
} = require('./sync-whatsapp.js');
const {
  sync: syncIMessage
} = require('./sync-imessage.js');

// Routes
const messagingRoutes = require("./routes/messaging.js");
const syncRoutes = require("./routes/sync.js");
const settingsRoutes = require("./routes/settings.js");
const bridgeRoutes = require("./routes/bridge.js");
const contactRoutes = require("./routes/contacts.js");
const systemRoutes = require("./routes/system.js");
const trainingRoutes = require("./routes/training.js");
const staticRoutes = require("./routes/static.js");
const { serveKyc, serveAnalyzeContact } = require("./routes/kyc.js");
const serviceManager = require("./service-manager.js");
const hubRuntime = require("./hub-runtime.js");
const { ensureWorkerCanStartFromHub } = require("./ensure-hub-worker.js");

// Start Managed Services
try {
  serviceManager.setStatus('hatori', 'loading in queue');
  serviceManager.setStatus('worker', 'loading in queue');

    if (process.env.REPLY_USE_HATORI === '1' && fs.existsSync(HATORI_PROJECT_PATH)) {
      const hatoriPort = process.env.REPLY_HATORI_PORT || '23572';

      if (process.env.REPLY_HATORI_EXTERNAL === '1') {
        replyHubDebugLog(`[ServiceManager] Hatori is managed externally. Skipping sidecar spawn.`);
        serviceManager.setStatus('hatori', 'external');
      } else {
        statusManager.update("system", { progress: 30, message: "Starting Hatori sidecar..." });
        // Check if Hatori is already running (e.g. menubar daemon) before spawning
        const hatoriHealthUrl = `http://127.0.0.1:${hatoriPort}/v1/health`;
        fetch(hatoriHealthUrl, { signal: AbortSignal.timeout(3500) })
          .then(r => {
            if (r.ok) {
              replyHubDebugLog(`[ServiceManager] Hatori already running on port ${hatoriPort} (external). Skipping spawn.`);
              serviceManager.setStatus('hatori', 'external');
          } else {
            spawnHatoriSidecar();
          }
        })
        .catch(() => {
          // Port not responding — safe to spawn our own sidecar
          spawnHatoriSidecar();
        });
    }

    function spawnHatoriSidecar() {
      const venvPython = path.join(HATORI_PROJECT_PATH, '.venv/bin/python');
      const pythonCmd = fs.existsSync(venvPython) ? venvPython : 'python3';
      serviceManager.start('hatori', pythonCmd, [
        '-m', 'uvicorn', 'api.app:app',
        '--host', '127.0.0.1',
        '--port', hatoriPort
      ], HATORI_PROJECT_PATH);
    }
  }

  statusManager.update("system", { progress: 50, message: "Launching background worker..." });
  ensureWorkerCanStartFromHub(__dirname);
  serviceManager.start('worker', path.join(__dirname, 'background-worker.js'));
  statusManager.update("system", { status: "online", progress: 100, message: "All systems ready" });
} catch (e) {
  console.error("[Startup Error]", e);
  statusManager.update("system", { status: "error", message: e.message });
}

const PORT_MIN = parseInt(process.env.PORT || "45311", 10);
let boundPort = PORT_MIN;
const securityPolicy = getSecurityPolicy(process.env);
const analysisInFlightByHandle = new Map();

/**
 * Main Request Handler
 */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // 1. Core Security Middleware
  if (!securityMiddleware.handleSecurity(req, res, boundPort, securityPolicy)) return;

  // 2. Static Content & Assets
  if (pathname === "/" || pathname === "/index.html") return staticRoutes.serveIndex(req, res, securityPolicy);
  if (pathname === "/settings" || pathname === "/settings.html") return staticRoutes.serveSettingsPage(req, res, securityPolicy);
  if (pathname.startsWith('/css/') || pathname.startsWith('/js/') || pathname.startsWith('/public/') || pathname.startsWith('/fragments/')) {
    return staticRoutes.serveAsset(req, res, pathname);
  }
  if (/^\/[a-zA-Z0-9_-]+\.svg$/.test(pathname)) return staticRoutes.serveRootSvg(req, res, pathname);

  // 3. API Routes Dispatch
  const auth = (opts) => securityMiddleware.authorizeSensitiveRoute(req, res, securityPolicy, opts);

  // Messaging
  if (pathname === "/api/conversations") return messagingRoutes.serveConversations(req, res, url);
  if (pathname === "/api/thread") return messagingRoutes.serveThread(req, res, url);
  if (pathname === "/api/suggest") return messagingRoutes.serveSuggest(req, res);
  if (pathname === "/api/refine-reply" || pathname === "/api/refine") return messagingRoutes.serveRefineReply(req, res);
  if (pathname === "/api/feedback") return messagingRoutes.serveFeedback(req, res);
  if (pathname === "/api/hatori/outcome" || pathname === "/api/hatori-outcome") return messagingRoutes.serveHatoriOutcome(req, res);

  // Sending (Sensitive)
  if (pathname === "/api/send-whatsapp") return auth({ route: pathname, action: "send-whatsapp", requireHumanApproval: true }) && messagingRoutes.serveSendWhatsApp(req, res);
  if (pathname === "/api/send-imessage") return auth({ route: pathname, action: "send-imessage", requireHumanApproval: true }) && messagingRoutes.serveSendMessage(req, res, 'imessage');
  if (pathname === "/api/send-linkedin") return auth({ route: pathname, action: "send-linkedin", requireHumanApproval: true }) && messagingRoutes.serveSendMessage(req, res, 'linkedin');
  if (pathname === "/api/send-email") return auth({ route: pathname, action: "send-email", requireHumanApproval: true }) && messagingRoutes.serveSendMessage(req, res, 'email');

  // Sync
  if (pathname === "/api/sync-notes") return auth({ route: pathname, action: "sync-notes" }) && syncRoutes.serveSyncNotes(req, res);
  if (pathname === "/api/sync-imessage") return auth({ route: pathname, action: "sync-imessage" }) && syncRoutes.serveSyncIMessage(req, res);
  if (pathname === "/api/sync-mail") return auth({ route: pathname, action: "sync-mail" }) && syncRoutes.serveSyncMail(req, res);
  if (pathname === "/api/sync-whatsapp") return auth({ route: pathname, action: "sync-whatsapp" }) && syncRoutes.serveSyncWhatsApp(req, res);
  if (pathname === "/api/sync-linkedin") return auth({ route: pathname, action: "sync-linkedin" }) && syncRoutes.serveSyncLinkedIn(req, res);
  if (pathname === "/api/sync-linkedin-posts") return auth({ route: pathname, action: "sync-linkedin-posts" }) && syncRoutes.serveSyncLinkedInPosts(req, res);
  if (pathname === "/api/sync-contacts") return auth({ route: pathname, action: "sync-contacts" }) && syncRoutes.serveSyncContacts(req, res);
  if (pathname === "/api/sync-kyc") return auth({ route: pathname, action: "sync-kyc" }) && syncRoutes.serveSyncKyc(req, res);
  if (pathname === "/api/import/linkedin") return auth({ route: pathname, action: "import-linkedin" }) && syncRoutes.serveImportLinkedIn(req, res);

  // Settings
  if (pathname === "/api/settings") return (req.method !== "POST" || auth({ route: pathname, action: "update-settings" })) && settingsRoutes.serveSettings(req, res);
  if (pathname === "/api/gmail/auth-url") return settingsRoutes.serveGmailAuthUrl(req, res);
  if (pathname === "/api/gmail/oauth-callback") return settingsRoutes.serveGmailOAuthCallback(req, res, url);
  if (pathname === "/api/gmail/disconnect") return auth({ route: pathname, action: "disconnect-gmail" }) && settingsRoutes.serveGmailDisconnect(req, res);
  if (pathname === "/api/gmail/check") return settingsRoutes.serveGmailCheck(req, res);

  // KYC & Contacts
  if (pathname === "/api/kyc") return serveKyc(req, res, url, auth, () => messagingRoutes.invalidateConversationsCache());
  if (pathname === "/api/analyze-contact") return serveAnalyzeContact(req, res, auth, analysisInFlightByHandle);
  if (pathname === "/api/contacts/merge") return auth({ route: pathname, action: "merge-contact" }) && contactRoutes.serveMerge(req, res, () => messagingRoutes.invalidateConversationsCache());
  if (pathname === "/api/contacts/aliases" && req.method === "GET") {
    return auth({ route: pathname, action: "merge-contact", requireHumanApproval: false }) && contactRoutes.serveListAliases(req, res, url);
  }
  if (pathname === "/api/contacts/unlink-alias") {
    return auth({ route: pathname, action: "merge-contact" }) && contactRoutes.serveUnlinkAlias(req, res, () => messagingRoutes.invalidateConversationsCache());
  }
  if (pathname === "/api/contacts/update-status" || pathname === "/api/update-status" || pathname === "/api/status") return contactRoutes.serveUpdateStatus(req, res);
  if (pathname === "/api/update-contact") return auth({ route: pathname, action: "update-contact" }) && contactRoutes.serveUpdateContact(req, res);
  if (pathname === "/api/add-note") return auth({ route: pathname, action: "add-note" }) && contactRoutes.serveAddNote(req, res);
  if (pathname === "/api/update-note") return auth({ route: pathname, action: "update-note" }) && contactRoutes.serveUpdateNote(req, res);
  if (pathname === "/api/delete-note") return auth({ route: pathname, action: "delete-note" }) && contactRoutes.serveDeleteNote(req, res, url);
  if (pathname === "/api/accept-suggestion") return contactRoutes.serveAcceptSuggestion(req, res);
  if (pathname === "/api/decline-suggestion") return contactRoutes.serveDeclineSuggestion(req, res);

  // Channel Bridge
  if (pathname === "/api/channel-bridge/inbound") return auth({ route: pathname, action: "bridge-inbound", requireHumanApproval: false }) && bridgeRoutes.serveInbound(req, res, () => messagingRoutes.invalidateConversationsCache());
  if (pathname === "/api/channel-bridge/summary") return bridgeRoutes.serveSummary(req, res, url);
  if (pathname === "/api/channel-bridge/events") return bridgeRoutes.serveEventsList(req, res, url);

  // System Health
  if (pathname === "/api/health" || pathname === "/api/system-health" || pathname === "/api/system/services") return systemRoutes.serveSystemHealth(req, res);
  if (pathname === "/api/system/service/control") return auth({ route: pathname, action: "service-control" }) && systemRoutes.serveServiceControl(req, res);
  if (pathname === "/api/openclaw/status") return systemRoutes.serveOpenClawStatus(req, res);
  if (pathname === "/api/triage-log") return systemRoutes.serveTriageLog(req, res);

  // Training / golden examples (LanceDB)
  if (pathname === "/api/training/annotations") {
    if (req.method === "GET") {
      return auth({ route: pathname, action: "read-training" }) && trainingRoutes.serveAnnotationsGet(req, res);
    }
    if (req.method === "DELETE") {
      return auth({ route: pathname, action: "delete-training" }) && trainingRoutes.serveAnnotationsDelete(req, res);
    }
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  if (pathname === "/api/messages/annotate") {
    return auth({ route: pathname, action: "annotate-message" }) && trainingRoutes.serveMessageAnnotate(req, res);
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found", path: pathname }));
});

/**
 * Port discovery and server start
 */
function tryListen(port) {
  server.removeAllListeners("error");
  server.removeAllListeners("listening");

  server.once("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.warn(`Port ${port} in use, trying ${port + 1}...`);
      tryListen(port + 1);
    } else {
      throw err;
    }
  });

  server.once("listening", () => {
    boundPort = server.address().port;
    hubRuntime.setListenInfo(boundPort, "127.0.0.1");
    console.log(`Reply POC server running at http://localhost:${boundPort}`);
  });

  server.listen(port, "127.0.0.1");
}

// Background sync loop for continuous learning
const SYNC_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
let autoSyncIntervalId = null;
autoSyncIntervalId = setInterval(() => {
  replyHubDebugLog("[Auto-Sync] Running background sync for continuous learning...");
  Promise.all([
    syncWhatsApp().catch(err => console.error("[Auto-Sync] WhatsApp failed:", err.message)),
    syncIMessage().catch(err => console.error("[Auto-Sync] iMessage failed:", err.message))
  ]).then(() => {
    replyHubDebugLog("[Auto-Sync] Background sync complete.");
  });
}, SYNC_INTERVAL_MS);

// Security Guard Enforcement
const { enforceOpenClawWhatsAppGuard } = require("./openclaw-guard.js");
try {
  enforceOpenClawWhatsAppGuard();
} catch (e) {
  console.warn("OpenClaw guard enforcement failed on startup:", e.message);
}

let shuttingDown = false;
async function gracefulShutdown(trigger) {
  if (shuttingDown) return;
  shuttingDown = true;
  replyHubDebugLog(`[Hub] ${trigger} received; closing HTTP server and stopping managed services...`);
  if (autoSyncIntervalId) {
    clearInterval(autoSyncIntervalId);
    autoSyncIntervalId = null;
  }
  try {
    await serviceManager.shutdownAllAsync();
  } catch (e) {
    console.error("[Hub] shutdownAllAsync error:", e.message);
  }
  await new Promise((resolve) => {
    server.close((err) => {
      if (err) console.error("[Hub] server.close:", err.message);
      resolve();
    });
  });
  process.exit(0);
}

process.once("SIGTERM", () => {
  gracefulShutdown("SIGTERM").catch((e) => console.error("[Hub] gracefulShutdown:", e));
});
process.once("SIGINT", () => {
  gracefulShutdown("SIGINT").catch((e) => console.error("[Hub] gracefulShutdown:", e));
});

tryListen(PORT_MIN);
