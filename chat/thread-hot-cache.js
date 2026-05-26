const MAX_THREADS = 8;
const MAX_NEWEST_MESSAGES = 80;
const cache = new Map();

function normalizeHandle(value) {
  return String(value || "").trim();
}

function messageTimestampMs(message) {
  const raw = message?.date || message?.timestamp || message?.occurred_at || null;
  const ms = raw ? Date.parse(String(raw)) : 0;
  return Number.isFinite(ms) ? ms : 0;
}

function messageKey(message) {
  const id = String(message?.id || message?.message_id || "").trim();
  if (id) return id;
  return [
    String(message?.handle || "").trim(),
    messageTimestampMs(message),
    String(message?.text || "").trim(),
  ].join("|");
}

function compareMessagesAscending(left, right) {
  return messageTimestampMs(left) - messageTimestampMs(right);
}

function dedupeMessages(messages = []) {
  const seen = new Set();
  const out = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    const key = messageKey(message);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(message);
  }
  return out;
}

function buildThreadCursor(messages = []) {
  const sorted = dedupeMessages(messages).sort(compareMessagesAscending);
  const latest = sorted[sorted.length - 1] || null;
  if (!latest) return null;
  return `${messageTimestampMs(latest)}:${messageKey(latest)}`;
}

function parseThreadCursor(raw) {
  const text = String(raw || "").trim();
  if (!text) return { timestampMs: 0, key: "" };
  const separator = text.indexOf(":");
  if (separator === -1) {
    return { timestampMs: Number(text) || 0, key: "" };
  }
  return {
    timestampMs: Number(text.slice(0, separator)) || 0,
    key: text.slice(separator + 1).trim(),
  };
}

function trimCache() {
  while (cache.size > MAX_THREADS) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) break;
    cache.delete(oldestKey);
  }
}

function touch(handle, entry) {
  cache.delete(handle);
  cache.set(handle, entry);
  trimCache();
}

function cacheThreadSnapshot(handle, payload = {}) {
  const normalizedHandle = normalizeHandle(handle);
  if (!normalizedHandle) return null;
  const newestMessages = dedupeMessages(payload.newestMessages || payload.messages || []).sort(compareMessagesAscending);
  const oldestMessages = dedupeMessages(payload.oldestMessages || []).sort(compareMessagesAscending);
  const entry = {
    handle: normalizedHandle,
    total: Number(payload.total) || newestMessages.length || oldestMessages.length || 0,
    newestMessages: newestMessages.slice(-MAX_NEWEST_MESSAGES),
    oldestMessages,
    conversationId: payload.conversationId || null,
    channels: Array.isArray(payload.channels) ? payload.channels : [],
    allowedChannels: Array.isArray(payload.allowedChannels) ? payload.allowedChannels : [],
    defaultChannel: payload.defaultChannel || null,
    conversationKind: payload.conversationKind || "direct",
    conversationTitle: payload.conversationTitle || null,
    updatedAt: new Date().toISOString(),
  };
  entry.deltaCursor = buildThreadCursor(entry.newestMessages);
  entry.threadVersion = entry.deltaCursor;
  touch(normalizedHandle, entry);
  return entry;
}

function getThreadSnapshot(handle) {
  const normalizedHandle = normalizeHandle(handle);
  if (!normalizedHandle) return null;
  const entry = cache.get(normalizedHandle);
  if (!entry) return null;
  touch(normalizedHandle, entry);
  return {
    ...entry,
    newestMessages: [...entry.newestMessages],
    oldestMessages: [...entry.oldestMessages],
  };
}

function appendThreadMessages(handle, messages = [], metadata = {}) {
  const normalizedHandle = normalizeHandle(handle);
  if (!normalizedHandle) return null;
  const existing = getThreadSnapshot(normalizedHandle) || cacheThreadSnapshot(normalizedHandle, metadata);
  const mergedNewest = dedupeMessages([
    ...(existing?.newestMessages || []),
    ...(Array.isArray(messages) ? messages : []),
  ]).sort(compareMessagesAscending);
  const next = {
    ...(existing || {}),
    total: Math.max(Number(metadata.total) || 0, Number(existing?.total) || 0, mergedNewest.length),
    newestMessages: mergedNewest.slice(-MAX_NEWEST_MESSAGES),
    oldestMessages: existing?.oldestMessages || [],
    conversationId: metadata.conversationId || existing?.conversationId || null,
    channels: Array.isArray(metadata.channels) && metadata.channels.length ? metadata.channels : (existing?.channels || []),
    allowedChannels: Array.isArray(metadata.allowedChannels) && metadata.allowedChannels.length ? metadata.allowedChannels : (existing?.allowedChannels || []),
    defaultChannel: metadata.defaultChannel || existing?.defaultChannel || null,
    conversationKind: metadata.conversationKind || existing?.conversationKind || "direct",
    conversationTitle: metadata.conversationTitle || existing?.conversationTitle || null,
    updatedAt: new Date().toISOString(),
  };
  next.deltaCursor = buildThreadCursor(next.newestMessages);
  next.threadVersion = next.deltaCursor;
  touch(normalizedHandle, next);
  return getThreadSnapshot(normalizedHandle);
}

function getThreadDelta(handle, afterCursor) {
  const entry = getThreadSnapshot(handle);
  if (!entry) {
    return {
      messages: [],
      deltaCursor: null,
      threadVersion: null,
      fromCache: false,
    };
  }
  const parsed = parseThreadCursor(afterCursor);
  const messages = entry.newestMessages.filter((message) => {
    const timestampMs = messageTimestampMs(message);
    if (timestampMs > parsed.timestampMs) return true;
    if (timestampMs < parsed.timestampMs) return false;
    return parsed.key && messageKey(message) !== parsed.key;
  });
  return {
    messages,
    deltaCursor: entry.deltaCursor,
    threadVersion: entry.threadVersion,
    fromCache: true,
  };
}

module.exports = {
  appendThreadMessages,
  buildThreadCursor,
  cacheThreadSnapshot,
  getThreadDelta,
  getThreadSnapshot,
  parseThreadCursor,
};
