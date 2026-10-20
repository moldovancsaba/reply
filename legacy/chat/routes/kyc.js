const path = require("path");
const { execFile } = require("child_process");
const contactStore = require("../contact-store.js");
const messageStore = require("../message-store.js");
const conversationFoundationStore = require("../conversation-foundation-store.js");
const { mergeProfile } = require("../kyc-merge.js");
const { normalizeStoredDisplayName, presentContactLabel } = require("../utils/contact-labels.js");
const { channelFromDoc, inferChannelFromHandle } = require("../utils/chat-utils.js");

/** Allowed channel buckets on a profile (reply#22). */
function sanitizeClientChannels(raw) {
    if (!raw || typeof raw !== "object") return null;
    const allowed = ["phone", "email", "whatsapp", "linkedin", "imessage"];
    const out = {};
    for (const t of allowed) {
        if (!Array.isArray(raw[t])) continue;
        out[t] = [...new Set(raw[t].map((x) => String(x || "").trim()).filter(Boolean))];
    }
    return Object.keys(out).length ? out : null;
}

// Helper functions that will be refactored into a utils.js file later
function writeJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function readJsonBody(req) {
  const body = await readRequestBody(req);
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}

function uniqueSorted(values = []) {
    return Array.from(new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))).sort();
}

function sanitizeCustomerFlags(raw) {
  return Array.from(new Set((Array.isArray(raw) ? raw : [])
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean)))
    .slice(0, 12);
}

function summarizeUnifiedProfile({ handle, contact, aliases = [], handles = [], conversationSummaries = [], recentRows = [] }) {
  const canonicalId = contact?.primary_contact_id || contact?.id || null;
  const channelCoverage = new Set();
  const allowedChannels = new Set();
  const coverageCounts = {};
  const conversationIds = new Set();
  let latestActiveAt = "";
  let latestInboundAt = "";
  let latestOutboundAt = "";

  for (const summary of Array.isArray(conversationSummaries) ? conversationSummaries : []) {
    const conversationId = String(summary?.conversationId || "").trim();
    if (conversationId) conversationIds.add(conversationId);
    for (const channel of Array.isArray(summary?.channels) ? summary.channels : []) {
      const key = String(channel || "").trim().toLowerCase();
      if (!key) continue;
      channelCoverage.add(key);
      coverageCounts[key] = (coverageCounts[key] || 0) + 1;
    }
    for (const channel of Array.isArray(summary?.allowedChannels) ? summary.allowedChannels : []) {
      const key = String(channel || "").trim().toLowerCase();
      if (!key) continue;
      allowedChannels.add(key);
    }
    if (String(summary?.latestMessageAt || "").trim() > latestActiveAt) latestActiveAt = String(summary.latestMessageAt || "").trim();
    if (String(summary?.latestInboundAt || "").trim() > latestInboundAt) latestInboundAt = String(summary.latestInboundAt || "").trim();
    if (String(summary?.latestOutboundAt || "").trim() > latestOutboundAt) latestOutboundAt = String(summary.latestOutboundAt || "").trim();
  }

  for (const row of Array.isArray(recentRows) ? recentRows : []) {
    const key = String(row?.channel || channelFromDoc({ path: row?.path, source: row?.source }) || inferChannelFromHandle(row?.handle || handle) || "").trim().toLowerCase();
    if (!key) continue;
    channelCoverage.add(key);
    if (coverageCounts[key] == null) coverageCounts[key] = 0;
  }

  const aliasContacts = Array.isArray(aliases) ? aliases : [];
  const channelEntries = contact?.channels && typeof contact.channels === "object" ? Object.entries(contact.channels) : [];
  const identities = uniqueSorted([
    ...(Array.isArray(handles) ? handles : []),
    ...(aliasContacts.map((alias) => alias.handle)),
    ...(channelEntries.flatMap(([, values]) => Array.isArray(values) ? values : [])),
  ]);
  const availableChannels = uniqueSorted([
    ...channelCoverage,
    ...channelEntries
      .filter(([, values]) => Array.isArray(values) && values.length)
      .map(([key]) => key === "phone" ? "imessage" : String(key || "").trim().toLowerCase())
  ]);

    return {
      canonicalContactId: canonicalId,
      presentationDisplayName: presentContactLabel(contact || {}, { handle }),
      aliasCount: aliasContacts.length,
      identityCount: identities.length,
      identities,
      owner: String(contact?.owner || "").trim() || null,
      customerFlags: sanitizeCustomerFlags(contact?.customerFlags || contact?.customer_flags),
      channelCoverage: availableChannels,
    channelCoverageCounts: coverageCounts,
    allowedChannels: uniqueSorted([...allowedChannels]),
    conversationCount: conversationIds.size,
    latestActiveAt: latestActiveAt || contact?.lastContacted || null,
    latestInboundAt: latestInboundAt || null,
    latestOutboundAt: latestOutboundAt || null,
    status: String(contact?.status || "").trim().toLowerCase() || "open",
  };
}

function buildRecentActivityTimeline({ handle, contact, aliases = [], recentRows = [] }) {
  const aliasSet = new Set((Array.isArray(aliases) ? aliases : []).map((alias) => String(alias?.id || "").trim()).filter(Boolean));
  const verifiedChannels = contact?.verifiedChannels && typeof contact.verifiedChannels === "object" ? contact.verifiedChannels : {};
  const events = (Array.isArray(recentRows) ? recentRows : []).map((row) => {
    const text = String(row?.text || "").trim();
    const channel = String(row?.channel || channelFromDoc({ path: row?.path, source: row?.source }) || inferChannelFromHandle(row?.handle || handle) || "other").trim().toLowerCase();
    const occurredAt = String(row?.timestamp || row?.date || "").trim() || null;
    return {
      kind: "message",
      channel,
      direction: row?.is_from_me ? "outbound" : "inbound",
      occurredAt,
      handle: String(row?.handle || handle || "").trim() || null,
      preview: text.length > 180 ? `${text.slice(0, 177)}...` : text,
    };
  });

  for (const [address, verifiedAt] of Object.entries(verifiedChannels)) {
    if (!verifiedAt || !address) continue;
    events.push({
      kind: "channel_verified",
      channel: String(address).includes("@") ? "email" : "imessage",
      direction: "system",
      occurredAt: String(verifiedAt).trim(),
      handle: String(address).trim(),
      preview: `Verified contact channel: ${address}`,
    });
  }

  for (const alias of Array.isArray(aliases) ? aliases : []) {
    if (!aliasSet.has(String(alias?.id || "").trim())) continue;
    events.push({
      kind: "alias_linked",
      channel: String(alias?.lastChannel || "").trim().toLowerCase() || "profile",
      direction: "system",
      occurredAt: String(alias?.lastContacted || alias?.visibility_changed_at || "").trim() || null,
      handle: String(alias?.handle || "").trim() || null,
      preview: `Linked profile alias: ${presentContactLabel(alias || {}, { handle: alias?.handle || "" })}`,
    });
  }

  return events
    .filter((event) => event.occurredAt)
    .sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt)))
    .slice(0, 12);
}


/**
 * API Endpoint: /api/kyc
 * GET  /api/kyc?handle=...
 * POST /api/kyc { handle, displayName/profession/relationship/intro } (accepts legacy {name, role} too)
 */
async function serveKyc(req, res, url, authorizeSensitiveRoute, onUpdate, bodyData = null) {
  if (req.method === "GET") {
    if (!authorizeSensitiveRoute(req, res, {
      route: "/api/kyc",
      action: "read-kyc",
      requireHumanApproval: false,
    })) {
      return;
    }
    await contactStore.refreshIfChanged(0);
    const handle = url.searchParams.get("handle");
    if (!handle) {
      writeJson(res, 400, { error: "Missing handle" });
      return;
    }

    const contact = contactStore.getContactRowByHandle(handle) || contactStore.findContact(handle);
    if (!contact) {
      console.warn(`[KYC] No contact found for handle: ${handle}`);
    }
    const canonicalId = contact?.primary_contact_id || contact?.id || null;
    const aliases = canonicalId ? contactStore.listAliasesForCanonical(canonicalId) : [];
    const allHandles = uniqueSorted(contactStore.getAllHandles(handle));
    const summaryMap = await conversationFoundationStore.getConversationSummariesByHandles(allHandles);
    const conversationSummaries = Array.from(summaryMap.values()).filter(Boolean);
    const recentMessages = await messageStore.getMessagesForHandles(allHandles, { limit: 12, offset: 0, order: "desc" });
    const unifiedProfile = summarizeUnifiedProfile({
      handle,
      contact,
      aliases,
      handles: allHandles,
      conversationSummaries,
      recentRows: recentMessages?.rows || [],
    });
    const recentActivity = buildRecentActivityTimeline({
      handle,
      contact,
      aliases,
      recentRows: recentMessages?.rows || [],
    });
    writeJson(res, 200, {
      handle,
      contactId: contact?.id || null,
      visibilityState: contact?.visibility_state || contact?.visibilityState || "active",
      visibilityChangedAt: contact?.visibility_changed_at || null,
      displayName: normalizeStoredDisplayName(contact?.displayName || contact?.name || "", handle),
      presentationDisplayName: presentContactLabel(contact || {}, { handle }),
      profession: contact?.profession || "",
      relationship: contact?.relationship || "",
      intro: contact?.intro || "",
      company: contact?.company || "",
      linkedinUrl: contact?.linkedinUrl || "",
      owner: contact?.owner || "",
      customerFlags: sanitizeCustomerFlags(contact?.customerFlags || contact?.customer_flags),
      draft: contact?.draft || "",
      notes: Array.isArray(contact?.notes) ? contact.notes : [],
      channels: contact?.channels || { phone: [], email: [] },
      verifiedChannels: contact?.verifiedChannels || {},
      pendingSuggestions: Array.isArray(contact?.pendingSuggestions) ? contact.pendingSuggestions : [],
      rejectedSuggestions: Array.isArray(contact?.rejectedSuggestions) ? contact.rejectedSuggestions : [],
      unifiedProfile,
      recentActivity,
    });
    return;
  }

  if (req.method === "POST") {
    try {
      const json = bodyData || await readJsonBody(req);
      if (!authorizeSensitiveRoute(req, res, {
        route: "/api/kyc",
        action: "update-kyc",
        payload: json,
      })) {
        return;
      }
      const handle = json.handle;
      if (!handle) {
        writeJson(res, 400, { error: "Missing handle" });
        return;
      }
      const hasExplicitOwner = Object.prototype.hasOwnProperty.call(json, "owner");

      const data = {
        displayName: (json.displayName ?? json.name ?? "").trim(),
        profession: (json.profession ?? json.role ?? "").trim(),
        company: (json.company ?? "").trim(),
        linkedinUrl: (json.linkedinUrl ?? "").trim(),
        owner: (json.owner ?? "").trim(),
        relationship: (json.relationship ?? "").trim(),
        intro: (json.intro ?? "").trim(),
        customerFlags: sanitizeCustomerFlags(json.customerFlags),
      };

      const ch = sanitizeClientChannels(json.channels);
      if (ch) data.channels = ch;

      // Don't overwrite with empty strings (channel objects are always truthy)
      Object.keys(data).forEach((k) => {
        if (k === "channels") return;
        if (k === "owner" && hasExplicitOwner) return;
        if (!data[k]) delete data[k];
      });

      await contactStore.updateContact(handle, data);
      await contactStore.refreshIfChanged(0);
      const contact = contactStore.getContactRowByHandle(handle) || contactStore.findContact(handle);
      if (typeof onUpdate === "function") {
        onUpdate(handle, contact);
      }
      writeJson(res, 200, { status: "ok", contact });
    } catch (e) {
      writeJson(res, 500, { error: e.message });
    }
    return;
  }

  writeJson(res, 405, { error: "Method not allowed" });
}


function analyzeContactInChild(handle) {
  const childScript = path.join(__dirname, "../kyc-analyze-child.js");
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [childScript, String(handle)],
      {
        cwd: __dirname,
        timeout: 5 * 60 * 1000,
        maxBuffer: 20 * 1024 * 1024,
        env: process.env
      },
      (err, stdout, stderr) => {
        if (err) {
          const signal = err.signal || null;
          const code = typeof err.code === "number" ? err.code : null;
          const suffix = signal ? ` (signal ${signal})` : code !== null ? ` (code ${code})` : "";
          const details = String((stderr || stdout || "")).trim();
          const msg =
            signal === "SIGSEGV" || /segmentation fault/i.test(details)
              ? `Analyzer crashed with a segmentation fault${suffix}.`
              : `Analyzer failed${suffix}.`;
          return reject(new Error(details ? `${msg} ${details}` : msg));
        }

        const out = String(stdout || "").trim();
        let parsed = null;
        try {
          parsed = out ? JSON.parse(out) : null;
        } catch {
          const details = String((stderr || stdout || "")).trim();
          return reject(new Error(details ? `Analyzer returned invalid JSON. ${details}` : "Analyzer returned invalid JSON."));
        }

        if (!parsed || parsed.status !== "ok") {
          return reject(new Error(parsed?.error || "Analyzer failed."));
        }

        resolve(parsed.profile || null);
      }
    );
  });
}

function analyzeContactDeduped(handle, analysisInFlightByHandle) {
  const key = String(handle || "").trim();
  if (!key) return Promise.reject(new Error("Missing handle"));
  const existing = analysisInFlightByHandle.get(key);
  if (existing) return existing;

  const p = analyzeContactInChild(key)
    .finally(() => {
      analysisInFlightByHandle.delete(key);
    });
  analysisInFlightByHandle.set(key, p);
  return p;
}


async function serveAnalyzeContact(req, res, authorizeSensitiveRoute, analysisInFlightByHandle) {
  if (req.method !== "POST") {
    writeJson(res, 405, { error: "Method not allowed" });
    return;
  }
  const payload = await readJsonBody(req);
  if (!authorizeSensitiveRoute(req, res, {
    route: "/api/analyze-contact",
    action: "analyze-contact",
    payload,
  })) {
    return;
  }
  try {
    const handle = (payload?.handle || "").toString().trim();
    if (!handle) {
      writeJson(res, 400, { error: "Missing handle" });
      return;
    }
    if (!contactStore.shouldUseForAnnotation(handle)) {
      writeJson(res, 409, { error: "Blocked contacts are excluded from annotation and analysis." });
      return;
    }

    const profile = await analyzeContactDeduped(handle, analysisInFlightByHandle);
    let updatedContact = null;
    if (profile) {
      updatedContact = await mergeProfile(profile);
    }

    writeJson(res, 200, {
      status: "ok",
      contact: updatedContact,
      message: profile ? "Analysis complete" : "Not enough data for analysis"
    });
  } catch (e) {
    console.error("Analysis error:", e);
    writeJson(res, 500, { error: e.message });
  }
}

module.exports = {
  serveKyc,
  serveAnalyzeContact,
  summarizeUnifiedProfile,
  buildRecentActivityTimeline,
};
