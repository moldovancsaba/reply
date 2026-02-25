const fs = require('fs');
const path = require('path');
const { simpleParser } = require('mailparser');
const { ImapFlow } = require('imapflow');
const { addDocuments } = require('./vector-store.js');
const contactStore = require('./contact-store.js');
const statusManager = require('./status-manager.js');
const { cleanMessageText } = require('./message-cleaner.js');

const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'imap_sync_state.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function normalizeEmail(val) {
  if (!val) return null;
  const v = String(val).trim().toLowerCase();
  return v.includes('@') ? v : null;
}

function parseBool(val, defaultValue = false) {
  if (val === undefined || val === null || val === '') return defaultValue;
  const s = String(val).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(s)) return false;
  return defaultValue;
}

function loadState() {
  ensureDataDir();
  if (!fs.existsSync(STATE_FILE)) return { mailboxes: {}, lastSync: null };
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { mailboxes: {}, lastSync: null };
  }
}

function saveState(state) {
  ensureDataDir();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function readSettings() {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) return {};
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function envOrSetting(key, fallback) {
  const v = process.env[key];
  if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  const settings = readSettings();
  const imap = settings?.imap || {};
  const map = {
    REPLY_IMAP_HOST: imap.host,
    REPLY_IMAP_PORT: imap.port,
    REPLY_IMAP_SECURE: imap.secure,
    REPLY_IMAP_USER: imap.user,
    REPLY_IMAP_PASS: imap.pass,
    REPLY_IMAP_MAILBOX: imap.mailbox,
    REPLY_IMAP_SENT_MAILBOX: imap.sentMailbox,
    REPLY_IMAP_LIMIT: imap.limit,
    REPLY_IMAP_SINCE_DAYS: imap.sinceDays,
    REPLY_SELF_EMAILS: imap.selfEmails,
  };
  return map[key] ?? fallback;
}

function updateMailStatus(newStatus) {
  return statusManager.update('mail', newStatus);
}

function getSelfEmails() {
  const fromEnv = (envOrSetting('REPLY_SELF_EMAILS', '') || '')
    .split(',')
    .map((s) => normalizeEmail(s))
    .filter(Boolean);
  const imapUser = normalizeEmail(envOrSetting('REPLY_IMAP_USER'));
  const self = new Set([...fromEnv, ...(imapUser ? [imapUser] : [])]);
  return self;
}

function pickCounterparty({ from, to, isFromMe, selfEmails }) {
  const fromAddr = normalizeEmail(from);
  const toAddrs = (Array.isArray(to) ? to : [])
    .map((a) => normalizeEmail(a))
    .filter(Boolean);

  if (isFromMe) {
    // Prefer first recipient that is not self.
    return toAddrs.find((a) => !selfEmails.has(a)) || toAddrs[0] || fromAddr;
  }
  return fromAddr || toAddrs.find((a) => !selfEmails.has(a)) || toAddrs[0] || null;
}

function mailboxKey(name) {
  return String(name || '').trim() || 'INBOX';
}

async function syncMailbox(client, mailboxName, opts) {
  const key = mailboxKey(mailboxName);
  const state = opts.state;
  const selfEmails = opts.selfEmails;

  const limit = Math.max(1, Math.min(Number(opts.limit) || 200, 2000));
  const sinceDays = Math.max(1, Math.min(Number(opts.sinceDays) || 30, 3650));

  const mState = state.mailboxes?.[key] || { lastUid: 0 };
  const lastUid = Number(mState.lastUid) || 0;

  let lock;
  try {
    lock = await client.getMailboxLock(mailboxName);
  } catch (e) {
    console.warn(`[IMAP] Failed to lock mailbox "${mailboxName}":`, e.message);
    return { fetched: 0, maxUid: lastUid };
  }

  try {
    // If this is the first run, don't fetch the entire mailbox; limit by recency.
    const uids = lastUid > 0
      ? await client.search({ uid: `${lastUid + 1}:*` })
      : await client.search({ since: new Date(Date.now() - sinceDays * 24 * 3600 * 1000) });

    if (!uids || uids.length === 0) return { fetched: 0, maxUid: lastUid };

    const uidsToFetch = lastUid > 0 ? uids.slice(0, limit) : uids.slice(-limit);

    const docs = [];
    let maxUidSeen = lastUid;

    for await (const msg of client.fetch(uidsToFetch, {
      uid: true,
      envelope: true,
      internalDate: true,
      source: true,
    })) {
      const uid = Number(msg.uid) || 0;
      if (uid > maxUidSeen) maxUidSeen = uid;

      const raw = msg.source;
      if (!raw) continue;

      let parsed;
      try {
        parsed = await simpleParser(raw);
      } catch (e) {
        console.warn(`[IMAP] Failed to parse message UID ${uid} in "${mailboxName}":`, e.message);
        continue;
      }

      const from = parsed?.from?.value?.[0]?.address || msg.envelope?.from?.[0]?.address || '';
      const to = (parsed?.to?.value || []).map((v) => v.address).filter(Boolean);
      const subject = (parsed?.subject || msg.envelope?.subject || '').toString().trim();
      const dateObj = parsed?.date || msg.internalDate || null;
      const date = dateObj instanceof Date && !Number.isNaN(dateObj.getTime())
        ? dateObj.toISOString()
        : new Date().toISOString();

      const fromAddr = normalizeEmail(from);
      const isFromMe = fromAddr ? selfEmails.has(fromAddr) : false;
      const counterparty = pickCounterparty({ from, to, isFromMe, selfEmails });
      if (!counterparty) continue;

      const text = (parsed?.text || '').toString().trim()
        || cleanMessageText(parsed?.html || '')
        || '';
      if (!text) continue;

      // Detect attachments
      const attachments = (parsed?.attachments || []).map(att => ({
        name: att.filename,
        size: att.size,
        contentType: att.contentType
      }));

      let finalText = text;
      if (attachments.length > 0) {
        finalText += `\n\n[ATTACHMENTS: ${JSON.stringify(attachments)}]`;
      }

      // Update contact store last contacted.
      try {
        contactStore.updateLastContacted(counterparty, date);
      } catch { }

      const safeSubject = subject ? `Subject: ${subject}\n\n` : '';
      const body = text.length > 2000 ? `${text.slice(0, 2000)}…` : text;

      docs.push({
        id: `imap-${key}-${uid}`,
        text: `[${date}] ${isFromMe ? 'Me' : counterparty}: ${safeSubject}${finalText}`,
        source: 'IMAP',
        path: `mailto:${counterparty}`,
      });
    }

    if (docs.length > 0) {
      await addDocuments(docs);
    }

    return { fetched: docs.length, maxUid: maxUidSeen };
  } finally {
    lock.release();
  }
}

/**
 * Sync emails via IMAP (Gmail supported via IMAP with an App Password).
 *
 * Required env:
 * - REPLY_IMAP_HOST
 * - REPLY_IMAP_USER
 * - REPLY_IMAP_PASS
 *
 * Optional env:
 * - REPLY_IMAP_PORT (default 993)
 * - REPLY_IMAP_SECURE (default true)
 * - REPLY_IMAP_MAILBOX (default INBOX)
 * - REPLY_IMAP_SENT_MAILBOX (optional)
 * - REPLY_IMAP_LIMIT (default 200, max 2000)
 * - REPLY_IMAP_SINCE_DAYS (default 30 for first run)
 * - REPLY_SELF_EMAILS (comma-separated; defaults to REPLY_IMAP_USER)
 */
async function syncImap() {
  const host = String(envOrSetting('REPLY_IMAP_HOST', '') || '').trim();
  const user = String(envOrSetting('REPLY_IMAP_USER', '') || '').trim();
  const pass = String(envOrSetting('REPLY_IMAP_PASS', '') || '').trim();

  if (!host || !user || !pass) {
    const msg = 'Missing IMAP config: set REPLY_IMAP_HOST, REPLY_IMAP_USER, REPLY_IMAP_PASS';
    updateMailStatus({ state: 'error', message: msg, connector: 'imap' });
    throw new Error(msg);
  }

  const port = Number(envOrSetting('REPLY_IMAP_PORT')) || 993;
  const secure = parseBool(envOrSetting('REPLY_IMAP_SECURE'), true);
  const mailbox = String(envOrSetting('REPLY_IMAP_MAILBOX', 'INBOX') || 'INBOX').trim();
  const sentMailbox = String(envOrSetting('REPLY_IMAP_SENT_MAILBOX', '') || '').trim();
  const limit = Number(envOrSetting('REPLY_IMAP_LIMIT')) || 200;
  const sinceDays = Number(envOrSetting('REPLY_IMAP_SINCE_DAYS')) || 30;

  updateMailStatus({ state: 'running', message: 'Connecting to IMAP…', connector: 'imap', host });

  const client = new ImapFlow({
    host,
    port,
    secure,
    auth: { user, pass },
    logger: false,
  });

  const state = loadState();
  const selfEmails = getSelfEmails();

  let fetchedTotal = 0;
  try {
    await client.connect();

    updateMailStatus({ state: 'running', progress: 10, message: `Syncing ${mailbox}…`, connector: 'imap' });
    const inboxRes = await syncMailbox(client, mailbox, { state, selfEmails, limit, sinceDays });
    fetchedTotal += inboxRes.fetched;
    state.mailboxes = state.mailboxes || {};
    state.mailboxes[mailboxKey(mailbox)] = { lastUid: inboxRes.maxUid };

    if (sentMailbox) {
      updateMailStatus({ state: 'running', progress: 60, message: `Syncing ${sentMailbox}…`, connector: 'imap' });
      const sentRes = await syncMailbox(client, sentMailbox, { state, selfEmails, limit, sinceDays });
      fetchedTotal += sentRes.fetched;
      state.mailboxes[mailboxKey(sentMailbox)] = { lastUid: sentRes.maxUid };
    }

    state.lastSync = new Date().toISOString();
    saveState(state);

    const currentStatus = statusManager.get('mail');
    const currentCount = Number(currentStatus.processed) || 0;

    updateMailStatus({
      state: 'idle',
      lastSync: state.lastSync,
      processed: currentCount + fetchedTotal,
      connector: 'imap',
      message: fetchedTotal > 0 ? `Synced ${fetchedTotal} emails` : 'No new emails',
    });

    return fetchedTotal;
  } catch (e) {
    updateMailStatus({ state: 'error', message: e.message, connector: 'imap' });
    throw e;
  } finally {
    try { await client.logout(); } catch { }
  }
}

module.exports = { syncImap };

if (require.main === module) {
  syncImap()
    .then((count) => console.log(`Finished. Synced ${count} emails.`))
    .catch((e) => {
      console.error('IMAP sync failed:', e.message);
      process.exitCode = 1;
    });
}
