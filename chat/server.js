/**
 * Reply POC — Localhost Chat Server
 * 
 * This server provides the backend for the "Local Brain" chat interface.
 * Refactored into specialized route modules for better maintainability.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

// Utilities & Middleware
const { writeJson } = require("./utils/server-utils.js");
const securityMiddleware = require("./middleware/security.js");
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
const { serveKyc, serveAnalyzeContact } = require("./routes/kyc.js");

// Project Constants
const PORT_MIN = parseInt(process.env.PORT || "3000", 10);
const HTML_PATH = path.join(__dirname, "index.html");
const PUBLIC_DIR = path.join(__dirname, "..", "public");

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
  if (!securityMiddleware.handleSecurity(req, res, boundPort, securityPolicy)) {
    return;
  }

  // 2. Static Content Handlers
  if (pathname === "/" || pathname === "/index.html") {
    fs.readFile(HTML_PATH, (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end("Error loading UI");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(data);
    });
    return;
  }

  // Static Assets (CSS/JS/Public)
  if (pathname.startsWith('/css/') || pathname.startsWith('/js/') || pathname.startsWith('/public/')) {
    const baseDir = pathname.startsWith('/public/') ? path.join(__dirname, "..") : __dirname;
    const filePath = path.join(baseDir, pathname);
    try {
      const content = await fs.promises.readFile(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const contentType = {
        '.css': 'text/css',
        '.js': 'application/javascript',
        '.json': 'application/json',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.webp': 'image/webp',
      }[ext] || 'text/plain';

      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
    return;
  }

  // Root SVG Assets (backward compatibility)
  if (/^\/[a-zA-Z0-9_-]+\.svg$/.test(pathname)) {
    const filePath = path.join(PUBLIC_DIR, pathname.slice(1));
    try {
      const content = await fs.promises.readFile(filePath);
      res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
    return;
  }

  // 3. API Routes Integration

  // Messaging & Conversations
  if (pathname === "/api/conversations") return messagingRoutes.serveConversations(req, res, url);
  if (pathname === "/api/thread") return messagingRoutes.serveThread(req, res, url);
  if (pathname === "/api/suggest") return messagingRoutes.serveSuggest(req, res);
  if (pathname === "/api/refine-reply") return messagingRoutes.serveRefineReply(req, res);
  if (pathname === "/api/feedback") return messagingRoutes.serveFeedback(req, res);

  // Sending (Sensitive)
  if (pathname === "/api/send-whatsapp") {
    if (!securityMiddleware.authorizeSensitiveRoute(req, res, securityPolicy, { route: pathname, action: "send-whatsapp", requireHumanApproval: true })) return;
    return messagingRoutes.serveSendWhatsApp(req, res);
  }
  if (pathname === "/api/send-imessage") {
    if (!securityMiddleware.authorizeSensitiveRoute(req, res, securityPolicy, { route: pathname, action: "send-imessage", requireHumanApproval: true })) return;
    return messagingRoutes.serveSendMessage(req, res, 'imessage');
  }
  if (pathname === "/api/send-linkedin") {
    if (!securityMiddleware.authorizeSensitiveRoute(req, res, securityPolicy, { route: pathname, action: "send-linkedin", requireHumanApproval: true })) return;
    return messagingRoutes.serveSendMessage(req, res, 'linkedin');
  }
  if (pathname === "/api/send-email") {
    if (!securityMiddleware.authorizeSensitiveRoute(req, res, securityPolicy, { route: pathname, action: "send-email", requireHumanApproval: true })) return;
    return messagingRoutes.serveSendMessage(req, res, 'email');
  }

  // Background Sync
  if (pathname === "/api/sync-notes") {
    if (!securityMiddleware.authorizeSensitiveRoute(req, res, securityPolicy, { route: pathname, action: "sync-notes" })) return;
    return syncRoutes.serveSyncNotes(req, res);
  }
  if (pathname === "/api/sync-imessage") {
    if (!securityMiddleware.authorizeSensitiveRoute(req, res, securityPolicy, { route: pathname, action: "sync-imessage" })) return;
    return syncRoutes.serveSyncIMessage(req, res);
  }
  if (pathname === "/api/sync-mail") {
    if (!securityMiddleware.authorizeSensitiveRoute(req, res, securityPolicy, { route: pathname, action: "sync-mail" })) return;
    return syncRoutes.serveSyncMail(req, res);
  }
  if (pathname === "/api/sync-whatsapp") {
    if (!securityMiddleware.authorizeSensitiveRoute(req, res, securityPolicy, { route: pathname, action: "sync-whatsapp" })) return;
    return syncRoutes.serveSyncWhatsApp(req, res);
  }
  if (pathname === "/api/sync-linkedin") {
    if (!securityMiddleware.authorizeSensitiveRoute(req, res, securityPolicy, { route: pathname, action: "sync-linkedin" })) return;
    return syncRoutes.serveSyncLinkedIn(req, res);
  }
  if (pathname === "/api/sync-linkedin-posts") {
    if (!securityMiddleware.authorizeSensitiveRoute(req, res, securityPolicy, { route: pathname, action: "sync-linkedin-posts" })) return;
    return syncRoutes.serveSyncLinkedInPosts(req, res);
  }
  if (pathname === "/api/sync-contacts") {
    if (!securityMiddleware.authorizeSensitiveRoute(req, res, securityPolicy, { route: pathname, action: "sync-contacts" })) return;
    return syncRoutes.serveSyncContacts(req, res);
  }
  if (pathname === "/api/sync-kyc") {
    if (!securityMiddleware.authorizeSensitiveRoute(req, res, securityPolicy, { route: pathname, action: "sync-kyc" })) return;
    return syncRoutes.serveSyncKyc(req, res);
  }

  // Settings & OAuth
  if (pathname === "/api/settings") {
    if (req.method === "POST" && !securityMiddleware.authorizeSensitiveRoute(req, res, securityPolicy, { route: pathname, action: "update-settings" })) return;
    return settingsRoutes.serveSettings(req, res);
  }
  if (pathname === "/api/gmail/auth-url") return settingsRoutes.serveGmailAuthUrl(req, res);
  if (pathname === "/api/gmail/oauth-callback") return settingsRoutes.serveGmailOAuthCallback(req, res, url);
  if (pathname === "/api/gmail/disconnect") {
    if (!securityMiddleware.authorizeSensitiveRoute(req, res, securityPolicy, { route: pathname, action: "disconnect-gmail" })) return;
    return settingsRoutes.serveGmailDisconnect(req, res);
  }
  if (pathname === "/api/gmail/check") return settingsRoutes.serveGmailCheck(req, res);

  // KYC & Contacts
  if (pathname === "/api/kyc") {
    return serveKyc(req, res, url,
      (req, res, opts) => securityMiddleware.authorizeSensitiveRoute(req, res, securityPolicy, opts),
      () => messagingRoutes.invalidateConversationsCache()
    );
  }
  if (pathname === "/api/analyze-contact") {
    return serveAnalyzeContact(req, res,
      (req, res, opts) => securityMiddleware.authorizeSensitiveRoute(req, res, securityPolicy, opts),
      analysisInFlightByHandle
    );
  }
  if (pathname === "/api/contacts/merge") {
    if (!securityMiddleware.authorizeSensitiveRoute(req, res, securityPolicy, { route: pathname, action: "merge-contact" })) return;
    return contactRoutes.serveMerge(req, res, () => messagingRoutes.invalidateConversationsCache());
  }
  if (pathname === "/api/contacts/update-status" || pathname === "/api/update-status" || pathname === "/api/status") {
    return contactRoutes.serveUpdateStatus(req, res);
  }
  if (pathname === "/api/update-contact") {
    if (!securityMiddleware.authorizeSensitiveRoute(req, res, securityPolicy, { route: pathname, action: "update-contact" })) return;
    return contactRoutes.serveUpdateContact(req, res);
  }
  if (pathname === "/api/add-note") {
    if (!securityMiddleware.authorizeSensitiveRoute(req, res, securityPolicy, { route: pathname, action: "add-note" })) return;
    return contactRoutes.serveAddNote(req, res);
  }
  if (pathname === "/api/update-note") {
    if (!securityMiddleware.authorizeSensitiveRoute(req, res, securityPolicy, { route: pathname, action: "update-note" })) return;
    return contactRoutes.serveUpdateNote(req, res);
  }
  if (pathname === "/api/delete-note") {
    if (!securityMiddleware.authorizeSensitiveRoute(req, res, securityPolicy, { route: pathname, action: "delete-note" })) return;
    return contactRoutes.serveDeleteNote(req, res, url);
  }
  if (pathname === "/api/accept-suggestion") return contactRoutes.serveAcceptSuggestion(req, res);
  if (pathname === "/api/decline-suggestion") return contactRoutes.serveDeclineSuggestion(req, res);

  // Channel Bridge
  if (pathname === "/api/channel-bridge/inbound") {
    if (!securityMiddleware.authorizeSensitiveRoute(req, res, securityPolicy, { route: pathname, action: "bridge-inbound", requireHumanApproval: false })) return;
    return bridgeRoutes.serveInbound(req, res, () => messagingRoutes.invalidateConversationsCache());
  }
  if (pathname === "/api/channel-bridge/summary") return bridgeRoutes.serveSummary(req, res, url);
  if (pathname === "/api/channel-bridge/events") return bridgeRoutes.serveEventsList(req, res, url);

  // System Health
  if (pathname === "/api/system-health") return systemRoutes.serveSystemHealth(req, res);
  if (pathname === "/api/openclaw/status") return systemRoutes.serveOpenClawStatus(req, res);
  if (pathname === "/api/triage-log") {
    const triageEngine = require('./triage-engine.js');
    const logs = triageEngine.getLogs(20);
    writeJson(res, 200, { logs });
    return;
  }

  // Catch-all
  res.writeHead(404);
  res.end("Not found");
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
    console.log(`{reply} POC server running at http://localhost:${boundPort}`);
  });

  server.listen(port, "127.0.0.1");
}

// Background sync loop for continuous learning
const SYNC_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
setInterval(() => {
  console.log("[Auto-Sync] Running background sync for continuous learning...");
  Promise.all([
    syncWhatsApp().catch(err => console.error("[Auto-Sync] WhatsApp failed:", err.message)),
    syncIMessage().catch(err => console.error("[Auto-Sync] iMessage failed:", err.message))
  ]).then(() => {
    console.log("[Auto-Sync] Background sync complete.");
  });
}, SYNC_INTERVAL_MS);

// Security Guard Enforcement
const { enforceOpenClawWhatsAppGuard } = require("./openclaw-guard.js");
try {
  enforceOpenClawWhatsAppGuard();
} catch (e) {
  console.warn("OpenClaw guard enforcement failed on startup:", e.message);
}

tryListen(PORT_MIN);
