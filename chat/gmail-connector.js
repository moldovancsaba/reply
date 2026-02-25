const fs = require("fs");
const path = require("path");
const statusManager = require("./status-manager.js");
const contactStore = require("./contact-store.js");
const { addDocuments } = require("./vector-store.js");
const { readSettings, writeSettings } = require("./settings-store.js");

const DATA_DIR = path.join(__dirname, "data");
const STATE_FILE = path.join(DATA_DIR, "gmail_sync_state.json");

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
];

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function updateMailStatus(newStatus) {
  return statusManager.update("mail", newStatus);
}

function loadState() {
  ensureDataDir();
  if (!fs.existsSync(STATE_FILE)) return { historyId: null, lastSync: null };
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { historyId: null, lastSync: null };
  }
}

function saveState(state) {
  ensureDataDir();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function base64UrlEncode(input) {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecodeToString(b64url) {
  if (!b64url) return "";
  const b64 = String(b64url).replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  return Buffer.from(b64 + pad, "base64").toString("utf8");
}

function stripHtml(html) {
  if (!html) return "";
  return String(html)
    .replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, "") // Remove style blocks content
    .replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, "") // Remove script blocks content
    .replace(/<[^>]*>/g, " ") // Remove tags
    .replace(/\s+/g, " ") // Collapse whitespace
    .trim();
}

function headerValue(headers, name) {
  const target = String(name || "").toLowerCase();
  const h = Array.isArray(headers) ? headers : [];
  const found = h.find((x) => String(x?.name || "").toLowerCase() === target);
  return (found?.value || "").toString();
}

function extractEmailAddress(headerVal) {
  const s = String(headerVal || "").trim();
  const m = s.match(/<([^>]+)>/);
  const email = (m ? m[1] : s).trim().toLowerCase();
  return email.includes("@") ? email : null;
}

function pickCounterparty({ fromHeader, toHeader, meEmail }) {
  const from = extractEmailAddress(fromHeader);
  const toList = String(toHeader || "")
    .split(",")
    .map((v) => extractEmailAddress(v))
    .filter(Boolean);

  const me = (meEmail || "").trim().toLowerCase();
  const isFromMe = from && me && from === me;
  if (isFromMe) {
    return toList.find((x) => x !== me) || toList[0] || from;
  }
  return from || toList.find((x) => x !== me) || toList[0] || null;
}

function parseGmailAuthErrorMessage(text) {
  const s = String(text || "");
  // Common JSON error shape: {"error":"invalid_grant","error_description":"..."}
  try {
    const j = JSON.parse(s);
    if (j?.error_description) return `${j.error}: ${j.error_description}`;
    if (j?.error) return String(j.error);
  } catch { }
  return s.slice(0, 300);
}

async function tokenRequest(params, retries = 3) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(params),
      });
      const text = await res.text();
      if (!res.ok) {
        throw new Error(`Token request failed: ${res.status} ${parseGmailAuthErrorMessage(text)}`);
      }
      return JSON.parse(text);
    } catch (e) {
      const isDnsError = e?.cause?.code === 'ENOTFOUND' || e?.code === 'ENOTFOUND' || e.message.includes('getaddrinfo');
      if (isDnsError && i < retries) {
        console.warn(`[Gmail] DNS error for ${GOOGLE_TOKEN_URL}, retrying in 2s... (${i + 1}/${retries})`);
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      throw e;
    }
  }
}

async function apiRequest(accessToken, pathname, options = {}) {
  const res = await fetch(`${GMAIL_API_BASE}${pathname}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Gmail API failed: ${res.status} ${text}`);
  }
  return text ? JSON.parse(text) : {};
}

async function getAccessToken(settings) {
  const gmail = settings?.gmail || {};
  const refreshToken = (gmail.refreshToken || "").trim();
  if (!refreshToken) throw new Error("Gmail not connected (missing refresh token)");

  const token = await tokenRequest({
    client_id: gmail.clientId,
    client_secret: gmail.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  return token.access_token;
}

function buildAuthUrl({ clientId, redirectUri, state }) {
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("state", state);
  return url.toString();
}

async function exchangeCodeForTokens({ code, redirectUri, settings }) {
  const gmail = settings?.gmail || {};
  const token = await tokenRequest({
    code,
    client_id: gmail.clientId,
    client_secret: gmail.clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  return token;
}

async function connectGmailFromCallback({ code, redirectUri }) {
  const settings = readSettings();
  const gmail = settings?.gmail || {};
  if (!gmail.clientId || !gmail.clientSecret) {
    throw new Error("Missing Gmail OAuth client config (clientId/clientSecret)");
  }

  updateMailStatus({ state: "running", message: "Completing Gmail connection…", connector: "gmail" });

  const token = await exchangeCodeForTokens({ code, redirectUri, settings });
  const refreshToken = token.refresh_token || gmail.refreshToken || "";
  if (!refreshToken) {
    throw new Error("No refresh token returned. Remove the app from Google Account and re-connect with consent.");
  }

  const next = { ...settings, gmail: { ...(settings.gmail || {}) } };
  next.gmail.refreshToken = refreshToken;
  next.gmail.connectedAt = new Date().toISOString();

  // Fetch profile to store account email + baseline historyId
  const accessToken = token.access_token || (await getAccessToken({ gmail: { ...next.gmail } }));
  const profile = await apiRequest(accessToken, "/profile");
  next.gmail.email = profile.emailAddress || next.gmail.email || "";
  next.gmail.historyId = profile.historyId || next.gmail.historyId || null;

  writeSettings(next);

  // Seed sync state historyId if we don't have one yet
  const st = loadState();
  if (!st.historyId && next.gmail.historyId) {
    st.historyId = String(next.gmail.historyId);
    st.lastSync = new Date().toISOString();
    saveState(st);
  }

  updateMailStatus({
    state: "idle",
    lastSync: new Date().toISOString(),
    connector: "gmail",
    message: `Connected Gmail: ${next.gmail.email || "ok"}`,
  });

  return { email: next.gmail.email || "" };
}

async function disconnectGmail() {
  const settings = readSettings();
  const next = { ...settings, gmail: { ...(settings.gmail || {}) } };
  delete next.gmail.refreshToken;
  delete next.gmail.historyId;
  delete next.gmail.email;
  delete next.gmail.connectedAt;
  writeSettings(next);

  try { fs.unlinkSync(STATE_FILE); } catch { }

  updateMailStatus({ state: "idle", connector: "gmail", message: "Disconnected Gmail" });
}

function extractTextFromPayload(payload) {
  if (!payload) return "";

  // Prefer text/plain
  const walk = (part) => {
    if (!part) return null;
    const mt = (part.mimeType || "").toLowerCase();
    if (mt === "text/plain" && part.body?.data) return { type: "plain", data: part.body.data };
    if (mt === "text/html" && part.body?.data) return { type: "html", data: part.body.data };
    const parts = Array.isArray(part.parts) ? part.parts : [];
    for (const p of parts) {
      const r = walk(p);
      if (r && r.type === "plain") return r;
      if (r) return r;
    }
    return null;
  };

  const found = walk(payload);
  if (!found?.data) return "";

  const decoded = base64UrlDecodeToString(found.data);
  let text = found.type === "html" ? stripHtml(decoded) : decoded.trim();

  // Detect attachments
  const attachments = [];
  const findAttachments = (p) => {
    if (p.filename && p.body?.attachmentId) {
      attachments.push({ name: p.filename, id: p.body.attachmentId, size: p.body.size });
    }
    if (p.parts) p.parts.forEach(findAttachments);
  };
  findAttachments(payload);

  if (attachments.length > 0) {
    text += `\n\n[ATTACHMENTS: ${JSON.stringify(attachments)}]`;
  }

  return text;
}

async function fetchMessage(accessToken, id) {
  return await apiRequest(accessToken, `/messages/${encodeURIComponent(id)}?format=full`);
}

function shouldIncludeMessageByScope(labelIds, scope) {
  const ids = Array.isArray(labelIds) ? labelIds.map((x) => String(x || "")) : [];
  const set = new Set(ids);
  const s = String(scope || "inbox_sent");
  if (s === "inbox_sent") return set.has("INBOX") || set.has("SENT");
  if (s === "all_mail") return !(set.has("SPAM") || set.has("TRASH"));
  return true; // custom or unknown scope
}

async function syncGmail({ maxMessages = 100 } = {}) {
  const settings = readSettings();
  const gmail = settings?.gmail || {};
  const gmailSync = gmail?.sync || {};
  const scope = (gmailSync.scope || "inbox_sent").toString();
  const query = (gmailSync.query || "").toString().trim();

  if (!gmail.clientId || !gmail.clientSecret || !gmail.refreshToken) {
    const msg = "Gmail not connected (missing OAuth credentials or refresh token)";
    updateMailStatus({ state: "error", message: msg, connector: "gmail" });
    throw new Error(msg);
  }

  updateMailStatus({ state: "running", message: "Syncing Gmail…", connector: "gmail", progress: 10 });

  const accessToken = await getAccessToken(settings);
  const profile = await apiRequest(accessToken, "/profile");
  const meEmail = (profile.emailAddress || gmail.email || "").toString().toLowerCase();

  const state = loadState();
  let messageIds = [];
  let shouldRunInitialSync = !state.historyId;

  if (state.historyId) {
    try {
      const history = await apiRequest(
        accessToken,
        `/history?startHistoryId=${encodeURIComponent(state.historyId)}&historyTypes=messageAdded`
      );
      shouldRunInitialSync = false;
      const hist = Array.isArray(history.history) ? history.history : [];
      const ids = new Set();
      for (const h of hist) {
        const added = Array.isArray(h.messagesAdded) ? h.messagesAdded : [];
        for (const a of added) {
          if (a?.message?.id) ids.add(a.message.id);
        }
      }
      messageIds = Array.from(ids).slice(0, maxMessages);
      if (history.historyId) state.historyId = String(history.historyId);
    } catch (e) {
      // When startHistoryId is too old, Gmail returns 404. Fall back to initial list.
      const msg = String(e?.message || "");
      if (!msg.includes("404")) throw e;
      state.historyId = null;
      messageIds = [];
      shouldRunInitialSync = true;
    }
  }

  if (shouldRunInitialSync) {
    // Initial sync: pull recent messages based on configured scope and set baseline historyId.
    const max = Math.min(maxMessages, 200);
    const ids = new Set();

    if (scope === "all_mail") {
      const q = "-in:spam -in:trash";
      const list = await apiRequest(accessToken, `/messages?maxResults=${max}&q=${encodeURIComponent(q)}`);
      for (const m of (list.messages || [])) if (m?.id) ids.add(m.id);
    } else if (scope === "custom" && query) {
      const list = await apiRequest(accessToken, `/messages?maxResults=${max}&q=${encodeURIComponent(query)}`);
      for (const m of (list.messages || [])) if (m?.id) ids.add(m.id);
    } else {
      // Default: inbox + sent.
      const listInbox = await apiRequest(accessToken, `/messages?maxResults=${max}&labelIds=INBOX`);
      const listSent = await apiRequest(accessToken, `/messages?maxResults=${max}&labelIds=SENT`);
      for (const m of (listInbox.messages || [])) if (m?.id) ids.add(m.id);
      for (const m of (listSent.messages || [])) if (m?.id) ids.add(m.id);
    }

    messageIds = Array.from(ids).slice(0, maxMessages);
    state.historyId = String(profile.historyId || state.historyId || "");
  }

  updateMailStatus({ state: "running", message: `Fetching ${messageIds.length} Gmail messages…`, connector: "gmail", progress: 40 });

  const docs = [];
  for (let i = 0; i < messageIds.length; i++) {
    const id = messageIds[i];
    try {
      const msg = await fetchMessage(accessToken, id);
      if (!shouldIncludeMessageByScope(msg?.labelIds, scope)) continue;

      const headers = msg?.payload?.headers || [];
      const subject = headerValue(headers, "Subject");
      const fromHeader = headerValue(headers, "From");
      const toHeader = headerValue(headers, "To");
      const dateHeader = headerValue(headers, "Date");
      const dateObj = dateHeader ? new Date(dateHeader) : null;
      const date = dateObj && !Number.isNaN(dateObj.getTime()) ? dateObj.toISOString() : new Date(Number(msg.internalDate) || Date.now()).toISOString();

      const counterparty = pickCounterparty({ fromHeader, toHeader, meEmail });
      if (!counterparty) continue;

      const fromEmail = extractEmailAddress(fromHeader);
      const isFromMe = !!(fromEmail && meEmail && fromEmail === meEmail);

      const body = extractTextFromPayload(msg.payload);
      if (!body) continue;

      contactStore.updateLastContacted(counterparty, date);

      const safeSubject = subject ? `Subject: ${subject}\n\n` : "";
      const clippedBody = body.length > 2000 ? `${body.slice(0, 2000)}…` : body;

      docs.push({
        id: `gmail-${id}`,
        text: `[${date}] ${isFromMe ? "Me" : counterparty}: ${safeSubject}${clippedBody}`,
        source: "Gmail",
        path: `mailto:${counterparty}`,
      });
    } catch (e) {
      console.warn("[Gmail] Failed to fetch message:", id, e.message);
    }
  }

  if (docs.length > 0) {
    updateMailStatus({ state: "running", message: `Vectorizing ${docs.length} Gmail messages…`, connector: "gmail", progress: 80 });
    await addDocuments(docs);
  }

  state.lastSync = new Date().toISOString();
  saveState(state);

  const currentStatus = statusManager.get("mail");
  const currentCount = Number(currentStatus.processed) || 0;

  updateMailStatus({
    state: "idle",
    lastSync: state.lastSync,
    processed: currentCount + docs.length,
    connector: "gmail",
    message: docs.length ? `Synced ${docs.length} Gmail emails` : "No new emails",
  });

  return docs.length;
}

async function sendGmail({ to, subject, text }) {
  const settings = readSettings();
  const gmail = settings?.gmail || {};
  if (!gmail.refreshToken) throw new Error("Gmail not connected");

  const accessToken = await getAccessToken(settings);
  const profile = await apiRequest(accessToken, "/profile");
  const from = (profile.emailAddress || gmail.email || "").trim();
  if (!from) throw new Error("Failed to determine Gmail account email");

  const safeSubject = (subject || "").replace(/\r|\n/g, " ").trim();
  const bodyText = String(text || "").replace(/\r\n/g, "\n");

  const raw = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${safeSubject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=\"UTF-8\"",
    "",
    bodyText,
  ].join("\r\n");

  const payload = { raw: base64UrlEncode(raw) };
  const resp = await apiRequest(accessToken, "/messages/send", { method: "POST", body: payload });
  return resp;
}

async function checkGmailConnection() {
  const settings = readSettings();
  const gmail = settings?.gmail || {};
  if (!gmail.clientId || !gmail.clientSecret || !gmail.refreshToken) {
    throw new Error("Gmail not connected (missing clientId/clientSecret/refreshToken)");
  }

  const accessToken = await getAccessToken(settings);
  const profile = await apiRequest(accessToken, "/profile");
  const email = (profile.emailAddress || gmail.email || "").toString().trim();
  const historyId = profile.historyId ? String(profile.historyId) : (gmail.historyId ? String(gmail.historyId) : "");

  // Opportunistically persist the account email if missing.
  if (email && email !== gmail.email) {
    const next = { ...settings, gmail: { ...(settings.gmail || {}) } };
    next.gmail.email = email;
    if (profile.historyId) next.gmail.historyId = String(profile.historyId);
    writeSettings(next);
  }

  return { email, historyId };
}

module.exports = {
  SCOPES,
  buildAuthUrl,
  connectGmailFromCallback,
  disconnectGmail,
  syncGmail,
  sendGmail,
  checkGmailConnection,
};
