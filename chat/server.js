/**
 * Reply POC — Localhost Chat Server
 * 
 * This server provides the backend for the "Local Brain" chat interface.
 * It serves the static HTML UI and handles API requests for:
 * 1. Generating reply suggestions based on local context.
 * 2. Syncing Apple Notes to the vector database.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
require("dotenv").config(); // Load environment variables

const { generateReply, extractKYC } = require('./reply-engine.js');
const { getSnippets } = require("./knowledge.js");
const { sync: syncIMessage } = require('./sync-imessage.js');
const { syncNotes } = require('./sync-notes.js');
const { syncWhatsApp } = require('./sync-whatsapp.js');
const triageEngine = require('./triage-engine.js');
const { refineReply } = require("./gemini-client.js");
const contactStore = require("./contact-store.js");
const { analyzeContact, mergeProfile } = require("./kyc-agent.js");

// Default to port 3000 if not specified in environment variables.
const PORT_MIN = parseInt(process.env.PORT || "3000", 10);
const HTML_PATH = path.join(__dirname, "index.html");

let boundPort = PORT_MIN;

/**
 * Serve the static HTML chat interface.
 */
function serveHtml(req, res) {
  fs.readFile(HTML_PATH, (err, data) => {
    if (err) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Error loading chat UI.");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(data);
  });
}

/**
 * API Endpoint: /api/suggest-reply
 * Generates a reply suggestion based on the user's message and local knowledge snippets.
 */
function serveSuggestReply(req, res) {
  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", async () => {
    let message = "";
    let recipient = null;
    try {
      const json = JSON.parse(body || "{}");
      message = json.message ?? json.text ?? "";
      recipient = json.recipient || null;
    } catch {
      message = body;
    }

    // Retrieve relevant context from the vector store (Hybrid Search).
    const snippets = await getSnippets(message, 3);

    // Generate a suggested reply using the local LLM.
    const suggestion = await generateReply(message, snippets, recipient);

    // Identify contact for UI display
    const contact = contactStore.findContact(recipient);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      suggestion,
      contact: contact ? { displayName: contact.displayName, profession: contact.profession } : null,
      snippets: snippets.map((s) => ({
        source: s.source,
        path: s.path,
        text: s.text.slice(0, 200) + (s.text.length > 200 ? "…" : "")
      }))
    }));
  });
}

/**
 * API Endpoint: /api/sync-notes
 * Triggers the Apple Notes synchronization process.
 * This runs in the background and updates the vector database with new or modified notes.
 */
function serveSyncNotes(req, res) {
  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  console.log("Received request to sync Apple Notes.");

  // Trigger the sync process. 
  // We return immediately to the UI, but the sync continues in the background.
  syncNotes()
    .then((stats) => {
      console.log("Sync completed successfully:", stats);
    })
    .catch((err) => {
      console.error("Background sync error:", err);
    });

  // Respond immediately to the client so the UI doesn't hang.
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "started", message: "Sync started in background" }));
}

/**
 * API Endpoint: /api/refine-reply
 * Uses Google Gemini to polish a drafted reply.
 */
function serveRefineReply(req, res) {
  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", async () => {
    let draft = "";
    let context = "";
    try {
      const json = JSON.parse(body || "{}");
      draft = json.draft || "";
      context = json.context || "";
    } catch {
      draft = body;
    }

    try {
      const refined = await refineReply(draft, context);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ refined }));
    } catch (e) {
      console.error("Gemini Error:", e.message);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
}

/**
 * API Endpoint: /api/feedback
 * Logs user feedback (Like/Dislike + Reason) to a JSONL file.
 */
function serveFeedback(req, res) {
  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    try {
      const entry = JSON.parse(body || "{}");
      // Add timestamp
      entry.timestamp = new Date().toISOString();

      const logLine = JSON.stringify(entry) + "\n";
      fs.appendFile(path.join(__dirname, "feedback.jsonl"), logLine, (err) => {
        if (err) console.error("Error writing feedback:", err);
      });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
    }
  });
}

// Create the HTTP server and route requests.
const server = http.createServer(async (req, res) => {
  // Use a dummy base URL to parse the path relative to the server root.
  const url = new URL(req.url || "/", `http://localhost:${boundPort}`);

  if (url.pathname === "/api/thread") {
    const handle = url.searchParams.get("handle");
    const limit = parseInt(url.searchParams.get("limit")) || 30;
    const offset = parseInt(url.searchParams.get("offset")) || 0;

    if (!handle) {
      res.writeHead(400);
      res.end("Missing handle");
      return;
    }

    const handles = contactStore.getAllHandles(handle);
    const { getHistory } = require("./vector-store.js");

    // Fetch history for all handles
    const historyPromises = handles.map(h => {
      const prefix = h.includes("@") ? `mailto:${h}` : `imessage://${h}`;
      return getHistory(prefix);
    });

    Promise.all(historyPromises).then(results => {
      // Flatten all docs into one list
      const allDocs = results.flat();

      // Convert vector docs to message history items and sort by date
      const allMessages = allDocs.map(d => {
        // Extract direction/role from text prefix [Date] Me/Handle: ...
        const isFromMe = d.text.includes("] Me:");
        return {
          role: isFromMe ? "me" : "contact",
          text: d.text.split(": ").slice(1).join(": "), // Strip the prefix
          date: d.text.match(/\[(.*?)\]/)?.[1] || "Unknown"
        };
      }).sort((a, b) => new Date(b.date) - new Date(a.date));

      const pagedMessages = allMessages.slice(offset, offset + limit);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        messages: pagedMessages,
        hasMore: allMessages.length > offset + limit,
        total: allMessages.length
      }));
    }).catch(err => {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    });
    return;
  }
  if (url.pathname === "/api/sync-mail") {
    console.log("Starting Mail sync in background...");
    const { syncMail } = require("./sync-mail.js");
    syncMail().then(count => {
      console.log(`Mail sync completed: ${count} emails.`);
    }).catch(err => {
      console.error(`Mail sync error: ${err.message}`);
    });

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "started", message: "Mail sync started in background" }));
    return;
  }
  if (url.pathname === "/api/conversations") {
    const limit = parseInt(url.searchParams.get("limit")) || 20;
    const offset = parseInt(url.searchParams.get("offset")) || 0;

    try {
      // Query LanceDB directly for contact list (database-level pagination)
      const { connect } = require('./vector-store.js');
      const db = await connect();
      const table = await db.openTable("documents");

      // Get distinct handles with their latest message timestamp
      // Note: LanceDB doesn't support GROUP BY, so we query and dedupe in JS
      // but limit data transfer by querying only recent messages
      // Use 384-dimension zero vector for full scan (all-MiniLM-L6-v2 embedding size)
      const zeroVector = new Array(384).fill(0);
      const results = await table
        .search(zeroVector)
        .where(`source IN ('iMessage', 'WhatsApp')`)
        .limit(10000)  // Get more than needed for deduplication
        .execute();

      // Convert results to array (LanceDB returns async iterator)
      let docs = [];
      if (Array.isArray(results)) {
        docs = results;
      } else {
        for await (const batch of results) {
          for (const row of batch) {
            docs.push(row.toJSON ? row.toJSON() : row);
          }
        }
      }

      // Group by handle (path) and get latest message time
      const contactMap = new Map();
      for (const doc of docs) {
        const handle = doc.path.replace(/^(imessage:\/\/|whatsapp:\/\/|mailto:)/, '');
        if (!contactMap.has(handle) || doc.timestamp > contactMap.get(handle).timestamp) {
          contactMap.set(handle, {
            handle,
            lastMessageTime: doc.timestamp,
            path: doc.path,
            source: doc.source
          });
        }
      }

      // Convert to array and sort by last message time
      const contacts = Array.from(contactMap.values())
        .sort((a, b) => b.lastMessageTime - a.lastMessageTime)
        .slice(offset, offset + limit);

      // Enrich with contact store data
      const enriched = contacts.map(c => {
        const contact = contactStore.getByHandle(c.handle);
        const hasDraft = contact?.status === "draft" && contact?.draft;
        return {
          id: contact?.id || c.handle,
          displayName: contact?.displayName || c.handle,
          handle: c.handle,
          lastMessage: hasDraft ? `Draft: ${contact.draft.slice(0, 50)}...` : "Click to see history",
          status: contact?.status || "open",
          draft: contact?.draft || null,
          channel: c.path.startsWith('whatsapp') ? 'whatsapp' : (c.handle.includes("@") ? "email" : "imessage"),
          lastContacted: contact?.lastContacted || new Date(c.lastMessageTime).toISOString()
        };
      });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        contacts: enriched,
        hasMore: contactMap.size > offset + limit,
        total: contactMap.size
      }));
    } catch (err) {
      console.error("Error loading conversations from database:", err);
      // Fallback to contact store if database query fails
      const list = contactStore.contacts
        .sort((a, b) => {
          const da = a.lastContacted ? new Date(a.lastContacted) : new Date(0);
          const db = b.lastContacted ? new Date(b.lastContacted) : new Date(0);
          return db - da;
        })
        .slice(offset, offset + limit)
        .map(c => {
          const hasDraft = c.status === "draft" && c.draft;
          return {
            id: c.id,
            displayName: c.displayName,
            handle: c.handle,
            lastMessage: hasDraft ? `Draft: ${c.draft.slice(0, 50)}...` : "Click to see history",
            status: c.status || "open",
            draft: c.draft || null,
            channel: c.handle && c.handle.includes("@") ? "email" : "imessage",
            lastContacted: c.lastContacted
          };
        });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        contacts: list,
        hasMore: contactStore.contacts.length > offset + limit,
        total: contactStore.contacts.length
      }));
    }
    return;
  }
  if (url.pathname === "/api/suggest-reply") {
    serveSuggestReply(req, res);
    return;
  }
  if (url.pathname === "/api/sync-notes") {
    serveSyncNotes(req, res);
    return;
  }
  if (url.pathname === "/api/sync-imessage") {
    console.log("Starting iMessage sync in background...");
    const { exec } = require("child_process");
    exec("node chat/sync-imessage.js", (error, stdout, stderr) => {
      if (error) {
        console.error(`Sync error: ${error.message}`);
        return;
      }
      if (stderr) console.warn(`Sync stderr: ${stderr}`);
      console.log(`Sync completed: ${stdout.trim()}`);
    });

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "started", message: "iMessage sync started in background" }));
    return;
  }
  if (url.pathname === "/api/send-imessage") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const { recipient, text } = JSON.parse(body);
      if (!recipient || !text) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing recipient or text" }));
        return;
      }

      const escapedMessage = text.replace(/"/g, '\\"');
      const appleScript = `
        tell application "Messages"
          set targetService to 1st service whose service type is iMessage
          set targetBuddy to buddy "${recipient}" of targetService
          send "${escapedMessage}" to targetBuddy
        end tell
      `;

      const { exec } = require("child_process");
      exec(`osascript -e '${appleScript}'`, (error, stdout) => {
        if (error) {
          console.error(`Send error: ${error}`);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: error.message }));
          return;
        }
        contactStore.clearDraft(recipient); // Clear draft on successful send
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
      });
    });
    return;
  }
  if (url.pathname === "/api/send-email") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", async () => {
      const { recipient, text } = JSON.parse(body);
      if (!recipient || !text) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing recipient or text" }));
        return;
      }

      // Using AppleScript to send via Mail.app
      const escapedMessage = text.replace(/"/g, '\\"');
      const appleScript = `
        tell application "Mail"
          set newMessage to make new outgoing message with properties {subject:"Follow-up from Reply Hub", content:"${escapedMessage}", visible:true}
          tell newMessage
            make new to recipient at end of to recipients with properties {address:"${recipient}"}
            -- send -- Uncomment to send automatically, keeping visible:true for safety now
          end tell
          activate
        end tell
      `;

      const { exec } = require("child_process");
      exec(`osascript -e '${appleScript}'`, (error, stdout) => {
        if (error) {
          console.error(`Send Mail error: ${error}`);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: error.message }));
          return;
        }
        contactStore.clearDraft(recipient);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
      });
    });
    return;
  }
  if (url.pathname === "/api/sync-contacts") {
    const { ingestContacts } = require("./ingest-contacts.js");
    ingestContacts().then(count => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", count: count }));
    }).catch(err => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.toString() }));
    });
    return;
  }
  if (url.pathname === "/api/update-contact") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const { handle, data } = JSON.parse(body);
        if (!handle || !data) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing handle or data" }));
          return;
        }

        const updatedContact = contactStore.updateContact(handle, data);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", contact: updatedContact }));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }
  if (url.pathname === "/api/clear-pending-kyc") {
    const handle = url.searchParams.get("handle");
    if (handle) {
      contactStore.clearPendingKYC(handle);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
    } else {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing handle" }));
    }
    return;
  }
  if (url.pathname === "/api/add-note") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const { handle, text } = JSON.parse(body);
        if (!handle || !text) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing handle or text" }));
          return;
        }
        contactStore.addNote(handle, text);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.toString() }));
      }
    });
    return;
  }
  if (url.pathname === "/api/delete-note") {
    const handle = url.searchParams.get("handle");
    const id = url.searchParams.get("id");
    if (handle && id) {
      contactStore.deleteNote(handle, id);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
    } else {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing handle or id" }));
    }
    return;
  }
  /**
   * API Endpoint: /api/system-health
   * Returns metadata about the server uptime, sync status, and contact database health.
   * Consolidated for Reply Hub v2.
   */
  if (url.pathname === "/api/system-health") {
    const DATA_DIR = path.join(__dirname, "data");

    const readStatus = (filename) => {
      const p = path.join(DATA_DIR, filename);
      if (fs.existsSync(p)) {
        try {
          return JSON.parse(fs.readFileSync(p, "utf8"));
        } catch (e) {
          return { state: "error", message: e.message };
        }
      }
      return { state: "idle", message: "No sync data available" };
    };

    // Read actual counts from sync_state files (source of truth)
    const getImessageCount = () => {
      const stateFile = path.join(DATA_DIR, "sync_state.json");
      if (fs.existsSync(stateFile)) {
        try {
          const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
          return state.lastProcessedId || 0;
        } catch (e) {
          return 0;
        }
      }
      return 0;
    };

    const getWhatsappCount = () => {
      const dbPath = path.join(process.env.HOME, 'Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite');
      // For now, read from status file (will be replaced with direct DB query)
      const status = readStatus("whatsapp_sync_status.json");
      return status.processed || 0;
    };

    const getNotesCount = () => {
      const notesMetadata = path.join(__dirname, '../knowledge/notes-metadata.json');
      if (fs.existsSync(notesMetadata)) {
        try {
          const data = JSON.parse(fs.readFileSync(notesMetadata, "utf8"));
          // notes-metadata.json is a cache object with note IDs as keys
          return Object.keys(data).length;
        } catch (e) {
          return 0;
        }
      }
      return 0;
    };

    // Build health response with counts from source of truth
    const imessageStatus = readStatus("imessage_sync_status.json");
    const whatsappStatus = readStatus("whatsapp_sync_status.json");
    const notesStatus = readStatus("notes_sync_status.json");

    const health = {
      uptime: Math.floor(process.uptime()),
      status: "online",
      channels: {
        imessage: {
          ...imessageStatus,
          processed: getImessageCount(),  // Override with actual database count
          total: getImessageCount()
        },
        whatsapp: {
          ...whatsappStatus,
          processed: getWhatsappCount(),
          total: getWhatsappCount()
        },
        notes: {
          ...notesStatus,
          processed: getNotesCount(),
          total: getNotesCount()
        },
        mail: readStatus("mail_sync_status.json"),
        contacts: readStatus("sync_state.json") // Legacy sync state compatibility
      },
      stats: contactStore.getStats(),
      lastCheck: new Date().toISOString()
    };

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(health));
    return;
  }
  if (url.pathname === "/api/update-status") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const { handle, status } = JSON.parse(body);
        if (!handle || !status) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing handle or status" }));
          return;
        }
        contactStore.updateStatus(handle, status);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.toString() }));
      }
    });
    return;
  }
  if (url.pathname === "/api/refine-reply") {
    serveRefineReply(req, res);
    return;
  }
  if (url.pathname === "/api/feedback") {
    serveFeedback(req, res);
    return;
  }
  if (url.pathname === "/api/sync-whatsapp") {
    if (req.method === "POST") {
      // Trigger background sync
      syncWhatsApp().catch(err => console.error("Manual WhatsApp Sync Error:", err));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "started" }));
    } else {
      res.writeHead(405);
      res.end("Method Not Allowed");
    }
    return;
  }

  if (url.pathname === "/api/analyze-contact") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", async () => {
      try {
        const { handle } = JSON.parse(body);
        if (!handle) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing handle" }));
          return;
        }

        const profile = await analyzeContact(handle);
        let updatedContact = null;
        if (profile) {
          updatedContact = await mergeProfile(profile);
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          status: "ok",
          contact: updatedContact,
          message: profile ? "Analysis complete" : "Not enough data for analysis"
        }));
      } catch (e) {
        console.error("Analysis error:", e);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (url.pathname === "/api/accept-suggestion") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const { handle, id } = JSON.parse(body);
        const contact = contactStore.acceptSuggestion(handle, id);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", contact }));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (url.pathname === "/api/triage-log") {
    const logs = triageEngine.getLogs(20);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ logs }));
    return;
  }

  if (url.pathname === "/api/decline-suggestion") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const { handle, id } = JSON.parse(body);
        const contact = contactStore.declineSuggestion(handle, id);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", contact }));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }
  if (url.pathname === "/" || url.pathname === "/index.html") {
    serveHtml(req, res);
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

/**
 * Attempt to listen on the specified port. 
 * If the port is in use, try the next available port.
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
    console.log(`Reply chat POC: http://localhost:${boundPort}`);
  });

  server.listen(port, "127.0.0.1");
}

tryListen(PORT_MIN);
