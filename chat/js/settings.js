import { getSettings, saveSettings, getGmailAuthUrl, disconnectGmail } from './api.js';
import {
  loadConversations,
  setConversationsQuery,
  setConversationsSort,
  applyConversationSortOnly,
  normalizeConversationSort,
  isValidConversationSortMode,
  CONVERSATION_SORT_STORAGE_KEY,
} from './contacts.js';

function el(id) {
  return document.getElementById(id);
}

let gmailHasSavedSecret = false;
let gmailHasRefreshToken = false;

function maskHint(value) {
  if (!value) return '';
  const s = String(value);
  if (s.length <= 4) return '••••';
  return `${'•'.repeat(Math.min(10, s.length - 2))}${s.slice(-2)}`;
}

function rebuildMailDefaultSelect(accounts, selectedId) {
  const sel = el('settings-mail-default-account');
  if (!sel) return;
  sel.innerHTML = '<option value="">Primary (built-in IMAP / Gmail)</option>';
  for (const a of accounts) {
    if (!a?.id) continue;
    const opt = document.createElement('option');
    opt.value = a.id;
    opt.textContent = a.label || a.id;
    sel.appendChild(opt);
  }
  const pick = selectedId && accounts.some((a) => a.id === selectedId) ? selectedId : '';
  sel.value = pick;
}

function renderMailAccountsList(accounts, defaultMailAccountId) {
  const root = el('settings-mail-accounts-list');
  if (!root) return;
  root.innerHTML = '';
  const list = Array.isArray(accounts) ? accounts : [];
  for (const acc of list) {
    if ((acc.provider || 'imap') !== 'imap') continue;
    const im = acc.imap || {};
    const row = document.createElement('div');
    row.className = 'settings-list-item-premium mb-md';
    row.style.flexDirection = 'column';
    row.style.alignItems = 'stretch';
    row.dataset.mailAccountRow = '1';
    row.dataset.accountId = acc.id || `mail-${Date.now().toString(36)}`;

    row.innerHTML = `
      <div class="u-flex-center-gap" style="justify-content:space-between;margin-bottom:8px;">
        <span class="u-font-weight-700">IMAP account</span>
        <label class="u-font-size-085 u-flex-center-gap" style="gap:6px;">
          <input type="checkbox" class="js-mail-acct-enabled" ${acc.enabled !== false ? 'checked' : ''}/> enabled
        </label>
        <button type="button" class="btn btn-ghost btn-sm js-mail-acct-remove">Remove</button>
      </div>
      <div class="settings-grid settings-grid-2">
        <div class="settings-field">
          <label class="settings-label">Label</label>
          <input type="text" class="settings-input js-mail-acct-label" placeholder="Work inbox" value="">
        </div>
        <div class="settings-field">
          <label class="settings-label">Account id</label>
          <input type="text" class="settings-input js-mail-acct-id" readonly value="">
        </div>
        <div class="settings-field">
          <label class="settings-label">Host</label>
          <input type="text" class="settings-input js-mail-acct-host" placeholder="imap.example.com" value="">
        </div>
        <div class="settings-field">
          <label class="settings-label">Port</label>
          <input type="number" class="settings-input js-mail-acct-port" value="993"/>
        </div>
        <div class="settings-field">
          <label class="settings-label">User</label>
          <input type="text" class="settings-input js-mail-acct-user" placeholder="user@example.com" value="">
        </div>
        <div class="settings-field">
          <label class="settings-label">Password</label>
          <input type="password" class="settings-input js-mail-acct-pass" placeholder="leave blank to keep" value="">
          <div class="settings-hint js-mail-acct-pass-hint"></div>
        </div>
        <div class="settings-field">
          <label class="settings-label">Inbox mailbox</label>
          <input type="text" class="settings-input js-mail-acct-mailbox" value="INBOX"/>
        </div>
        <div class="settings-field">
          <label class="settings-label">Sent mailbox (optional)</label>
          <input type="text" class="settings-input js-mail-acct-sent" value=""/>
        </div>
        <div class="settings-field">
          <label class="settings-label">Since days (first run)</label>
          <input type="number" class="settings-input js-mail-acct-since" value="30"/>
        </div>
        <div class="settings-field">
          <label class="settings-label">Fetch limit</label>
          <input type="number" class="settings-input js-mail-acct-limit" value="200"/>
        </div>
        <div class="settings-field" style="grid-column:1/-1;">
          <label class="settings-label">Self emails (comma-separated)</label>
          <input type="text" class="settings-input js-mail-acct-self" placeholder="alias@corp.com" value=""/>
        </div>
      </div>
    `;

    row.querySelector('.js-mail-acct-label').value = acc.label || acc.id || '';
    row.querySelector('.js-mail-acct-id').value = row.dataset.accountId;
    row.querySelector('.js-mail-acct-host').value = im.host || '';
    row.querySelector('.js-mail-acct-port').value = String(im.port != null ? im.port : 993);
    row.querySelector('.js-mail-acct-user').value = im.user || '';
    row.querySelector('.js-mail-acct-mailbox').value = im.mailbox || 'INBOX';
    row.querySelector('.js-mail-acct-sent').value = im.sentMailbox || '';
    row.querySelector('.js-mail-acct-since').value = String(im.sinceDays != null ? im.sinceDays : 30);
    row.querySelector('.js-mail-acct-limit').value = String(im.limit != null ? im.limit : 200);
    row.querySelector('.js-mail-acct-self').value = im.selfEmails || '';

    const passHint = row.querySelector('.js-mail-acct-pass-hint');
    const hasPass = im.hasPass === true || !!(im.pass && String(im.pass).trim());
    if (passHint) {
      passHint.textContent =
        hasPass && im.passHint ? `Saved: ${maskHint(im.passHint)}` : hasPass ? 'Saved' : 'Not set';
    }

    row.querySelector('.js-mail-acct-remove').onclick = () => {
      row.remove();
      rebuildMailDefaultSelect(collectMailAccountsFromDom(), el('settings-mail-default-account')?.value || '');
    };

    root.appendChild(row);
  }

  rebuildMailDefaultSelect(list, defaultMailAccountId || '');
}

function collectMailAccountsFromDom() {
  const root = el('settings-mail-accounts-list');
  if (!root) return [];
  const rows = root.querySelectorAll('[data-mail-account-row]');
  const out = [];
  for (const row of rows) {
    const id = row.querySelector('.js-mail-acct-id')?.value?.trim() || row.dataset.accountId;
    const label = row.querySelector('.js-mail-acct-label')?.value?.trim() || id;
    const host = row.querySelector('.js-mail-acct-host')?.value?.trim() || '';
    const port = Number(row.querySelector('.js-mail-acct-port')?.value) || 993;
    const user = row.querySelector('.js-mail-acct-user')?.value?.trim() || '';
    const pass = row.querySelector('.js-mail-acct-pass')?.value || '';
    const mailbox = row.querySelector('.js-mail-acct-mailbox')?.value?.trim() || 'INBOX';
    const sentMailbox = row.querySelector('.js-mail-acct-sent')?.value?.trim() || '';
    const sinceDays = Math.max(1, Math.min(Number(row.querySelector('.js-mail-acct-since')?.value) || 30, 3650));
    const limit = Math.max(1, Math.min(Number(row.querySelector('.js-mail-acct-limit')?.value) || 200, 2000));
    const selfEmails = row.querySelector('.js-mail-acct-self')?.value?.trim() || '';
    const enabled = row.querySelector('.js-mail-acct-enabled')?.checked !== false;
    if (!host || !user) continue;

    const imap = {
      host,
      port,
      secure: true,
      user,
      mailbox,
      sentMailbox,
      sinceDays,
      limit,
      selfEmails,
    };
    if (pass) imap.pass = pass;

    out.push({
      id,
      label,
      provider: 'imap',
      enabled,
      imap,
    });
  }
  return out;
}

export function applyReplyUiSettings(settings) {
  window.replySettings = settings || {};
  const ui = settings?.ui || {};
  const channels = ui.channels || {};

  const root = document.documentElement;
  const setVar = (name, value) => {
    if (!value) return;
    root.style.setProperty(name, String(value));
  };

  setVar('--bubble-me-imessage', channels?.imessage?.bubbleMe);
  setVar('--bubble-contact-imessage', channels?.imessage?.bubbleContact);
  setVar('--bubble-me-whatsapp', channels?.whatsapp?.bubbleMe);
  setVar('--bubble-contact-whatsapp', channels?.whatsapp?.bubbleContact);
  setVar('--bubble-me-email', channels?.email?.bubbleMe);
  setVar('--bubble-contact-email', channels?.email?.bubbleContact);
  setVar('--bubble-me-linkedin', channels?.linkedin?.bubbleMe);
  setVar('--bubble-contact-linkedin', channels?.linkedin?.bubbleContact);
}

function switchTab(tabId) {
  // Update nav items
  document.querySelectorAll('.settings-nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
  });

  // Update content sections
  document.querySelectorAll('.settings-tab-content').forEach(section => {
    section.classList.toggle('u-display-none', section.id !== `tab-content-${tabId}`);
  });

  // Update title
  const titles = {
    general: 'General Settings',
    email: 'Email Configuration',
    messaging: 'Messaging & Bridges',
    worker: 'Background Worker',
    'ai-status': 'AI & system status',
    security: 'Privacy & Security'
  };
  const titleEl = el('settings-tab-title');
  if (titleEl) titleEl.textContent = titles[tabId] || 'Settings';

  if (tabId === 'ai-status') {
    refreshAiProviderStatuses().catch((e) => console.warn('[settings] provider check:', e));
  }
}

async function refreshAiProviderStatuses() {
  const ollamaLine = el('settings-providers-ollama-line');
  const ocLine = el('settings-providers-openclaw-line');
  const hatLine = el('settings-providers-hatori-line');
  if (!ollamaLine && !ocLine) return;
  try {
    const { fetchSystemHealth, fetchOpenClawStatus } = await import('./api.js');
    const [health, oc] = await Promise.all([
      fetchSystemHealth({ silent: true }).catch(() => ({})),
      fetchOpenClawStatus().catch(() => ({ status: 'offline', error: 'unreachable' })),
    ]);
    if (ollamaLine) {
      const o = health.services?.ollama?.status || 'unknown';
      ollamaLine.textContent = `Status: ${o} — default port 11434 (OLLAMA_PORT overrides).`;
    }
    if (ocLine) {
      const s = oc.status || 'unknown';
      ocLine.textContent = `Status: ${s}${oc.error ? ` — ${oc.error}` : ''}${oc.detail ? ` (${oc.detail})` : ''}`;
    }
    if (hatLine) {
      const h = health.services?.hatori_api?.status || 'unknown';
      const d = health.services?.hatori_api?.detail || '';
      hatLine.textContent = `Status: ${h}${d ? ` (${d})` : ''}`;
    }
  } catch (e) {
    if (ollamaLine) ollamaLine.textContent = `Check failed: ${e?.message || e}`;
  }
}

async function loadIntoForm() {
  const data = await getSettings();
  applyReplyUiSettings(data);
  const imap = data?.imap || {};
  const gmail = data?.gmail || {};
  const gmailSync = gmail?.sync || {};
  const worker = data?.worker || {};
  const channelBridge = data?.channelBridge || {};
  const bridgeChannels = channelBridge?.channels || {};
  const ui = data?.ui || {};
  const channels = ui?.channels || {};
  const global = data?.global || {};

  // General
  const apiKeyInput = el('settings-global-google-api-key');
  if (apiKeyInput) {
    apiKeyInput.value = '';
    el('settings-global-google-api-key-hint').textContent = global.hasGoogleApiKey ? `Saved: ${maskHint(global.googleApiKeyHint)}` : 'Not set';
  }

  // UI
  const setVal = (id, val) => { const e = el(id); if (e) e.value = val; };
  setVal('settings-ui-imessage-emoji', channels?.imessage?.emoji || '💬');
  setVal('settings-ui-imessage-me', channels?.imessage?.bubbleMe || '#0a84ff');
  setVal('settings-ui-whatsapp-emoji', channels?.whatsapp?.emoji || '🟢');
  setVal('settings-ui-whatsapp-me', channels?.whatsapp?.bubbleMe || '#25D366');

  // Email
  setVal('settings-gmail-client-id', gmail.clientId || '');
  el('settings-gmail-client-secret').value = '';
  el('settings-gmail-client-secret-hint').textContent = gmail.hasClientSecret ? `Saved: ${maskHint(gmail.clientSecretHint)}` : 'Not set';
  el('settings-gmail-status').textContent = gmail.connectedEmail
    ? `Status: Connected as ${gmail.connectedEmail}`
    : (gmail.hasRefreshToken ? 'Status: Connected (email unknown)' : 'Status: Not connected');

  if (el('settings-gmail-scope')) el('settings-gmail-scope').value = gmailSync.scope || 'inbox_sent';

  setVal('settings-imap-host', imap.host || '');
  setVal('settings-imap-port', imap.port ? String(imap.port) : '993');
  setVal('settings-imap-user', imap.user || '');
  el('settings-imap-pass').value = '';
  el('settings-imap-pass-hint').textContent = imap.hasPass ? `Saved: ${maskHint(imap.passHint)}` : 'Not set';

  renderMailAccountsList(data.mailAccounts || [], data.defaultMailAccountId || '');

  // Messaging
  setVal('settings-bridge-telegram-mode', bridgeChannels?.telegram?.inboundMode || 'draft_only');
  setVal('settings-bridge-discord-mode', bridgeChannels?.discord?.inboundMode || 'draft_only');
  setVal('settings-bridge-linkedin-mode', bridgeChannels?.linkedin?.inboundMode || 'draft_only');

  // Worker
  setVal('settings-worker-interval', worker.pollIntervalSeconds ? String(worker.pollIntervalSeconds) : '60');
  setVal('settings-worker-imessage-max', worker.quantities?.imessage !== undefined ? String(worker.quantities.imessage) : '1000');
  setVal('settings-worker-whatsapp-max', worker.quantities?.whatsapp !== undefined ? String(worker.quantities.whatsapp) : '500');
  setVal('settings-worker-gmail-max', worker.quantities?.gmail !== undefined ? String(worker.quantities.gmail) : '100');
  setVal('settings-worker-notes-max', worker.quantities?.notes !== undefined ? String(worker.quantities.notes) : '0');

  const health = data?.health || {};
  setVal('settings-health-hatori-timeout', String(health.hatoriProbeTimeoutMs ?? 12000));
  setVal('settings-health-ollama-timeout', String(health.ollamaProbeTimeoutMs ?? 3000));
  setVal('settings-health-hatori-threshold', String(health.hatoriWatchdogFailureThreshold ?? 3));
  setVal('settings-health-ui-poll', String(health.uiHealthPollIntervalMs ?? 15000));
  standaloneHealthPollMs = Math.max(
    5000,
    Math.min(Number(health.uiHealthPollIntervalMs) || 15000, 300000)
  );
  restartStandaloneHealthPoll();

  const rt = data?.runtime || {};
  const hatWrap = el('settings-providers-hatori-wrap');
  if (hatWrap) {
    hatWrap.classList.toggle('u-display-none', !rt.useHatori);
    hatWrap.style.display = rt.useHatori ? '' : 'none';
  }

  // Security
  const localWrites = el('settings-global-local-writes');
  if (localWrites) localWrites.checked = global.localWritesOnly !== false;
  const reqApproval = el('settings-global-require-approval');
  if (reqApproval) reqApproval.checked = global.requireHumanApproval !== false;

  const opToken = el('settings-global-operator-token');
  if (opToken) {
    opToken.value = '';
    el('settings-global-operator-token-hint').textContent = global.hasOperatorToken ? `Saved: ${maskHint(global.operatorTokenHint)}` : 'Not set';
  }
  const reqToken = el('settings-global-require-token');
  if (reqToken) reqToken.checked = global.requireOperatorToken !== false;

  gmailHasSavedSecret = !!gmail.hasClientSecret;
  gmailHasRefreshToken = !!gmail.hasRefreshToken;

  const connectBtn = el('settings-gmail-connect');
  const disconnectBtn = el('settings-gmail-disconnect');
  if (disconnectBtn) disconnectBtn.style.display = gmailHasRefreshToken ? 'block' : 'none';
  if (connectBtn) connectBtn.textContent = gmailHasRefreshToken ? 'Re-connect Account' : 'Connect Account';

  applyReplyUiSettings(data);
}

async function onSave() {
  const btn = el('settings-save');
  const original = btn?.textContent || 'Save Changes';
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving...';
  }

  try {
    const payload = {
      global: {
        googleApiKey: el('settings-global-google-api-key')?.value || null,
        operatorToken: el('settings-global-operator-token')?.value || null,
        requireOperatorToken: el('settings-global-require-token')?.checked,
        localWritesOnly: el('settings-global-local-writes')?.checked,
        requireHumanApproval: el('settings-global-require-approval')?.checked,
      },
      gmail: {
        clientId: el('settings-gmail-client-id')?.value?.trim() || null,
        clientSecret: el('settings-gmail-client-secret')?.value || null,
        sync: {
          scope: el('settings-gmail-scope')?.value || 'inbox_sent'
        },
      },
      imap: {
        host: el('settings-imap-host')?.value?.trim() || null,
        port: Number(el('settings-imap-port')?.value) || 993,
        user: el('settings-imap-user')?.value?.trim() || null,
        pass: el('settings-imap-pass')?.value || null,
      },
      mailAccounts: collectMailAccountsFromDom(),
      defaultMailAccountId: el('settings-mail-default-account')?.value?.trim() || null,
      worker: {
        pollIntervalSeconds: Number(el('settings-worker-interval')?.value) || 60,
        quantities: {
          imessage: Number(el('settings-worker-imessage-max')?.value) || 1000,
          whatsapp: Number(el('settings-worker-whatsapp-max')?.value) || 500,
          gmail: Number(el('settings-worker-gmail-max')?.value) || 100,
          notes: Number(el('settings-worker-notes-max')?.value) || 0,
        }
      },
      health: {
        hatoriProbeTimeoutMs: Number(el('settings-health-hatori-timeout')?.value) || 12000,
        ollamaProbeTimeoutMs: Number(el('settings-health-ollama-timeout')?.value) || 3000,
        hatoriWatchdogFailureThreshold: Number(el('settings-health-hatori-threshold')?.value) || 3,
        uiHealthPollIntervalMs: Number(el('settings-health-ui-poll')?.value) || 15000,
      },
      channelBridge: {
        channels: {
          telegram: { inboundMode: el('settings-bridge-telegram-mode')?.value || 'draft_only' },
          discord: { inboundMode: el('settings-bridge-discord-mode')?.value || 'draft_only' },
          linkedin: { inboundMode: el('settings-bridge-linkedin-mode')?.value || 'draft_only' },
        }
      },
      ui: {
        channels: {
          imessage: {
            emoji: el('settings-ui-imessage-emoji')?.value || '💬',
            bubbleMe: el('settings-ui-imessage-me')?.value || '#0a84ff',
          },
          whatsapp: {
            emoji: el('settings-ui-whatsapp-emoji')?.value || '🟢',
            bubbleMe: el('settings-ui-whatsapp-me')?.value || '#25D366',
          }
        }
      },
    };

    await saveSettings(payload);
    await loadIntoForm();
    if (btn) {
      btn.textContent = 'Saved!';
      setTimeout(() => {
        try { btn.textContent = original; } catch { }
      }, 1500);
    }
  } catch (e) {
    console.error('Save failed:', e);
    alert(e?.message || 'Save failed');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function onConnectGmail() {
  try {
    const payload = {
      gmail: {
        clientId: el('settings-gmail-client-id')?.value?.trim() || '',
        clientSecret: el('settings-gmail-client-secret')?.value || '',
      },
    };
    await saveSettings(payload);
    const { url } = await getGmailAuthUrl();
    window.location.href = url;
  } catch (e) {
    alert(e?.message || 'Connect Gmail failed');
  }
}

async function onDisconnectGmail() {
  if (!confirm('Disconnect Gmail?')) return;
  try {
    await disconnectGmail();
    await loadIntoForm();
  } catch (e) {
    alert(e?.message || 'Disconnect failed');
  }
}

export async function openSettings() {
  // Ensure DOM is wired and fragment is loaded
  await wireDom();

  const page = el('settings-page');
  if (page) page.style.display = 'flex';
  document.body.classList.add('mode-settings');

  switchTab('general');
  await loadIntoForm();
}

export function closeSettings() {
  const page = el('settings-page');
  if (page) page.style.display = 'none';
  document.body.classList.remove('mode-settings');

  // If standalone, return to main app (same sidebar shell as index)
  if (window.location.pathname.includes('settings.html')) {
    window.location.href = 'index.html';
    return;
  }

  if (typeof window.selectContact === 'function') {
    window.selectContact(window.currentHandle || null);
  }
}

function isSettingsStandalonePage() {
  return typeof window.location !== 'undefined' && window.location.pathname.includes('settings.html');
}

let standaloneHealthIntervalId = null;
let standaloneHealthPollMs = 15000;

function restartStandaloneHealthPoll() {
  if (!isSettingsStandalonePage()) return;
  if (standaloneHealthIntervalId != null) {
    clearInterval(standaloneHealthIntervalId);
    standaloneHealthIntervalId = null;
  }
  pollStandaloneServiceHealth();
  standaloneHealthIntervalId = setInterval(pollStandaloneServiceHealth, standaloneHealthPollMs);
}

async function pollStandaloneServiceHealth() {
  const dot = document.getElementById('services-health-dot');
  const container = document.getElementById('services-health-status');
  if (!dot || !container) return;
  try {
    const { fetchSystemHealth, fetchOpenClawStatus } = await import('./api.js');
    const [health, openClaw] = await Promise.all([
      fetchSystemHealth().catch(() => ({ status: 'offline' })),
      fetchOpenClawStatus().catch(() => ({ status: 'offline' })),
    ]);
    const worker = health.services?.worker || { status: 'offline' };
    const isOpenClawOffline = openClaw.status !== 'online';
    const isWorkerOffline = worker.status !== 'online';
    if (isOpenClawOffline || isWorkerOffline) {
      dot.className = 'status-dot offline';
      container.title = `Services offline: ${isWorkerOffline ? 'Worker ' : ''}${isOpenClawOffline ? 'OpenClaw' : ''}`.trim();
    } else {
      dot.className = 'status-dot online';
      container.title = 'All services online.';
    }
  } catch {
    dot.className = 'status-dot warning';
    container.title = 'Health check failed.';
  }
}

function startStandaloneServiceHealthPoll() {
  restartStandaloneHealthPoll();
}

/**
 * Match index.html: contacts sidebar on the left, wire navigation into main app.
 */
function initStandaloneSettingsShell() {
  if (!isSettingsStandalonePage() || document.body.dataset.replySettingsShell === '1') return;
  document.body.dataset.replySettingsShell = '1';

  window.selectContact = (handle) => {
    if (handle == null || handle === '') {
      window.location.href = 'index.html';
      return;
    }
    try {
      sessionStorage.setItem('reply_open_handle', String(handle));
    } catch {
      /* ignore */
    }
    window.location.href = 'index.html';
  };

  const btnDash = document.getElementById('btn-dash');
  if (btnDash) btnDash.onclick = () => { window.location.href = 'index.html'; };

  const btnSettings = document.getElementById('btn-settings');
  if (btnSettings) btnSettings.onclick = () => {};

  const btnTraining = document.getElementById('btn-training');
  if (btnTraining) {
    btnTraining.onclick = () => {
      try {
        sessionStorage.setItem('reply_open_training', '1');
      } catch {
        /* ignore */
      }
      window.location.href = 'index.html';
    };
  }

  const contactSearch = document.getElementById('contact-search');
  if (contactSearch) {
    let timer = null;
    const run = () => setConversationsQuery(contactSearch.value);
    contactSearch.addEventListener('input', () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, 180);
    });
    contactSearch.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        contactSearch.value = '';
        run();
        contactSearch.blur();
      }
    });
  }

  const conversationSort = document.getElementById('conversation-sort');
  if (conversationSort) {
    try {
      const saved = window.localStorage && window.localStorage.getItem(CONVERSATION_SORT_STORAGE_KEY);
      if (saved && isValidConversationSortMode(saved)) {
        const v = normalizeConversationSort(saved);
        if ([...conversationSort.options].some((o) => o.value === v)) {
          conversationSort.value = v;
        }
      }
    } catch {
      /* ignore */
    }
    applyConversationSortOnly(conversationSort.value);
    conversationSort.addEventListener('change', () => {
      try {
        if (window.localStorage) {
          window.localStorage.setItem(CONVERSATION_SORT_STORAGE_KEY, conversationSort.value);
        }
      } catch {
        /* ignore */
      }
      setConversationsSort(conversationSort.value).catch((e) =>
        console.warn('[settings] Sort reload failed:', e)
      );
    });
  }

  startStandaloneServiceHealthPoll();
  loadConversations(false).catch((e) => console.warn('[settings] contacts load failed:', e));
}

/**
 * Wire DOM events for settings
 */
export async function wireDom() {
  const container = document.getElementById('settings-container');
  if (!container) return;

  initStandaloneSettingsShell();

  // Lazy load the settings fragment if not already loaded
  const hasPage = !!document.getElementById('settings-page');
  if (!hasPage) {
    try {
      const response = await fetch('fragments/settings-fragment.html?v=2.3');
      if (!response.ok) throw new Error('Failed to load settings fragment');
      const html = await response.text();
      container.innerHTML = html;
    } catch (error) {
      console.error('[SETTINGS] Fragment load error:', error);
      container.innerHTML = `<div class="u-padding-20 u-text-center u-color-danger">Error loading settings: ${error.message}</div>`;
      return;
    }
  }

  const page = document.getElementById('settings-page');
  const closeBtn = document.getElementById('settings-close');
  const saveBtn = document.getElementById('settings-save');
  const navItems = document.querySelectorAll('.settings-nav-item');

  if (closeBtn) closeBtn.onclick = closeSettings;
  if (saveBtn) saveBtn.onclick = onSave;

  const connectBtn = el('settings-gmail-connect');
  if (connectBtn) connectBtn.onclick = onConnectGmail;

  const disconnectBtn = el('settings-gmail-disconnect');
  if (disconnectBtn) disconnectBtn.onclick = onDisconnectGmail;

  const addMailAcct = el('settings-mail-add-account');
  if (addMailAcct) {
    addMailAcct.onclick = () => {
      const cur = collectMailAccountsFromDom();
      cur.push({
        id: `mail-${Date.now().toString(36)}`,
        label: 'Extra mailbox',
        provider: 'imap',
        enabled: true,
        imap: {
          host: '',
          port: 993,
          secure: true,
          user: '',
          mailbox: 'INBOX',
          sentMailbox: '',
          limit: 200,
          sinceDays: 30,
          selfEmails: '',
        },
      });
      renderMailAccountsList(cur, el('settings-mail-default-account')?.value || '');
    };
  }

  navItems.forEach(btn => {
    btn.onclick = () => switchTab(btn.getAttribute('data-tab'));
  });

  el('settings-providers-check-ollama')?.addEventListener('click', () => {
    refreshAiProviderStatuses().catch((e) => console.warn(e));
  });
  el('settings-providers-check-openclaw')?.addEventListener('click', () => {
    refreshAiProviderStatuses().catch((e) => console.warn(e));
  });
  el('settings-providers-check-hatori')?.addEventListener('click', () => {
    refreshAiProviderStatuses().catch((e) => console.warn(e));
  });
  el('settings-providers-check-all')?.addEventListener('click', () => {
    refreshAiProviderStatuses().catch((e) => console.warn(e));
  });
}

window.openSettings = openSettings;
window.closeSettings = closeSettings;

// Auto-open if in standalone mode
if (window.location.pathname.includes('settings.html')) {
  setTimeout(() => openSettings(), 100);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', wireDom);
} else {
  wireDom();
}
