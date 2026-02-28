import { getSettings, saveSettings, getGmailAuthUrl, disconnectGmail } from './api.js';

function el(id) {
  return document.getElementById(id);
}

let gmailHasSavedSecret = false;
let gmailHasRefreshToken = false;
let currentSettingsFilter = null;
let previousHandleBeforeSettings = null;
let previousWasDashboard = false;

function setVisible(element, visible) {
  if (!element) return;
  element.style.display = visible ? 'flex' : 'none';
}

function maskHint(value) {
  if (!value) return '';
  const s = String(value);
  if (s.length <= 4) return '••••';
  return `${'•'.repeat(Math.min(10, s.length - 2))}${s.slice(-2)}`;
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

function setNodeVisible(node, visible) {
  if (!node) return;
  if (visible) {
    const restore = node.getAttribute('data-display');
    node.style.display = restore !== null ? restore : '';
    return;
  }
  if (!node.getAttribute('data-display')) {
    try {
      const display = window.getComputedStyle(node).display;
      node.setAttribute('data-display', display && display !== 'none' ? display : 'block');
    } catch {
      node.setAttribute('data-display', 'block');
    }
  }
  node.style.display = 'none';
}

function applySettingsFilter(filterKey) {
  currentSettingsFilter = filterKey || null;
  const bar = el('settings-filter-bar');
  const label = el('settings-filter-label');
  setVisible(bar, !!currentSettingsFilter);

  if (label) {
    const name =
      currentSettingsFilter === 'imessage' ? 'iMessage' :
        currentSettingsFilter === 'whatsapp' ? 'WhatsApp' :
          currentSettingsFilter === 'bridge' ? 'Bridge' :
            currentSettingsFilter === 'notes' ? 'Notes' :
              currentSettingsFilter === 'email' ? 'Email' :
                currentSettingsFilter === 'linkedin' ? 'LinkedIn' :
                  'Settings';
    label.textContent = `Configuring: ${name}`;
  }

  // Top-level sections
  const mailSection = el('settings-channel-mail');
  const gmailSection = el('settings-channel-gmail');
  const workerSection = el('settings-section-worker');
  const bridgeSection = el('settings-section-channel-bridge');
  const uiSection = el('settings-section-ui');

  // Bridge wrappers
  const bridgeTel = el('settings-bridge-telegram-wrap');
  const bridgeDis = el('settings-bridge-discord-wrap');
  const bridgeSig = el('settings-bridge-signal-wrap');
  const bridgeVib = el('settings-bridge-viber-wrap');
  const bridgeLin = el('settings-bridge-linkedin-wrap');

  const showAll = !currentSettingsFilter;

  if (showAll) {
    setNodeVisible(mailSection, true);
    setNodeVisible(gmailSection, true);
    setNodeVisible(workerSection, true);
    setNodeVisible(bridgeSection, true);
    // General Settings should not show per-service appearance controls.
    setNodeVisible(uiSection, false);

    // Show only global worker interval in general settings.
    setNodeVisible(el('settings-worker-interval-wrap'), true);
    setNodeVisible(el('settings-worker-imessage-wrap'), false);
    setNodeVisible(el('settings-worker-whatsapp-wrap'), false);
    setNodeVisible(el('settings-worker-gmail-wrap'), false);
    setNodeVisible(el('settings-channel-notes'), false);

    setNodeVisible(el('settings-channel-imessage'), false);
    setNodeVisible(el('settings-channel-whatsapp'), false);
    setNodeVisible(el('settings-channel-email'), false);
    setNodeVisible(el('settings-channel-linkedin'), false);

    // Show all bridge items
    setNodeVisible(bridgeTel, true);
    setNodeVisible(bridgeDis, true);
    setNodeVisible(bridgeSig, true);
    setNodeVisible(bridgeVib, true);
    setNodeVisible(bridgeLin, true);
    return;
  }

  // Hide worker section for per-channel filters unless specifically needed
  // (We'll show it only if the channel has specific worker settings)
  setNodeVisible(workerSection, false);
  setNodeVisible(el('settings-worker-interval-wrap'), false);

  if (currentSettingsFilter === 'imessage') {
    setNodeVisible(mailSection, false);
    setNodeVisible(gmailSection, false);
    setNodeVisible(uiSection, true);
    setNodeVisible(bridgeSection, false);

    setNodeVisible(workerSection, true);
    setNodeVisible(el('settings-worker-imessage-wrap'), true);
    setNodeVisible(el('settings-worker-whatsapp-wrap'), false);
    setNodeVisible(el('settings-worker-gmail-wrap'), false);
    setNodeVisible(el('settings-channel-notes'), false);

    setNodeVisible(el('settings-channel-imessage'), true);
    setNodeVisible(el('settings-channel-whatsapp'), false);
    setNodeVisible(el('settings-channel-email'), false);
    setNodeVisible(el('settings-channel-linkedin'), false);
    return;
  }

  if (currentSettingsFilter === 'whatsapp') {
    setNodeVisible(mailSection, false);
    setNodeVisible(gmailSection, false);
    setNodeVisible(uiSection, true);
    setNodeVisible(bridgeSection, false);

    setNodeVisible(workerSection, true);
    setNodeVisible(el('settings-worker-imessage-wrap'), false);
    setNodeVisible(el('settings-worker-whatsapp-wrap'), true);
    setNodeVisible(el('settings-worker-gmail-wrap'), false);
    setNodeVisible(el('settings-channel-notes'), false);

    setNodeVisible(el('settings-channel-imessage'), false);
    setNodeVisible(el('settings-channel-whatsapp'), true);
    setNodeVisible(el('settings-channel-email'), false);
    setNodeVisible(el('settings-channel-linkedin'), false);
    return;
  }

  if (currentSettingsFilter === 'notes') {
    setNodeVisible(mailSection, false);
    setNodeVisible(gmailSection, false);
    setNodeVisible(uiSection, false);
    setNodeVisible(bridgeSection, false);

    setNodeVisible(workerSection, true);
    setNodeVisible(el('settings-worker-imessage-wrap'), false);
    setNodeVisible(el('settings-worker-whatsapp-wrap'), false);
    setNodeVisible(el('settings-worker-gmail-wrap'), false);
    setNodeVisible(el('settings-channel-notes'), true);
    return;
  }

  if (currentSettingsFilter === 'email') {
    setNodeVisible(mailSection, true);
    setNodeVisible(gmailSection, true);
    setNodeVisible(uiSection, true);
    setNodeVisible(bridgeSection, false);

    setNodeVisible(workerSection, true);
    setNodeVisible(el('settings-worker-imessage-wrap'), false);
    setNodeVisible(el('settings-worker-whatsapp-wrap'), false);
    setNodeVisible(el('settings-worker-gmail-wrap'), true);
    setNodeVisible(el('settings-channel-notes'), false);

    setNodeVisible(el('settings-channel-imessage'), false);
    setNodeVisible(el('settings-channel-whatsapp'), false);
    setNodeVisible(el('settings-channel-email'), true);
    setNodeVisible(el('settings-channel-linkedin'), false);
    return;
  }

  if (currentSettingsFilter === 'linkedin') {
    setNodeVisible(mailSection, false);
    setNodeVisible(gmailSection, false);
    setNodeVisible(uiSection, false); // Section itself is hidden as we show the channel block
    setNodeVisible(bridgeSection, false);

    setNodeVisible(workerSection, false);
    setNodeVisible(el('settings-worker-interval-wrap'), false);

    setNodeVisible(el('settings-channel-imessage'), false);
    setNodeVisible(el('settings-channel-whatsapp'), false);
    setNodeVisible(el('settings-channel-email'), false);
    setNodeVisible(el('settings-channel-linkedin'), true);
    return;
  }

  if (currentSettingsFilter === 'bridge') {
    setNodeVisible(mailSection, false);
    setNodeVisible(gmailSection, false);
    setNodeVisible(workerSection, false);
    setNodeVisible(uiSection, false);
    setNodeVisible(bridgeSection, true);

    // Show all bridge items
    setNodeVisible(bridgeTel, true);
    setNodeVisible(bridgeDis, true);
    setNodeVisible(bridgeSig, true);
    setNodeVisible(bridgeVib, true);
    setNodeVisible(bridgeLin, true);
    return;
  }
}

function refreshGmailButtons() {
  const clientId = el('settings-gmail-client-id')?.value?.trim() || '';
  const typedSecret = el('settings-gmail-client-secret')?.value || '';

  const connectBtn = el('settings-gmail-connect');
  const disconnectBtn = el('settings-gmail-disconnect');

  if (connectBtn) {
    connectBtn.disabled = !(clientId && (gmailHasSavedSecret || !!typedSecret.trim()));
  }
  if (disconnectBtn) {
    disconnectBtn.disabled = !gmailHasRefreshToken;
  }
}

async function loadIntoForm() {
  const data = await getSettings();
  const imap = data?.imap || {};
  const gmail = data?.gmail || {};
  const gmailSync = gmail?.sync || {};
  const worker = data?.worker || {};
  const channelBridge = data?.channelBridge || {};
  const bridgeChannels = channelBridge?.channels || {};
  const ui = data?.ui || {};
  const channels = ui?.channels || {};
  const global = data?.global || {};

  el('settings-global-google-api-key').value = '';
  el('settings-global-google-api-key-hint').textContent = global.hasGoogleApiKey ? `Saved: ${maskHint(global.googleApiKeyHint)}` : 'Not set';
  el('settings-global-operator-token').value = '';
  el('settings-global-operator-token-hint').textContent = global.hasOperatorToken ? `Saved: ${maskHint(global.operatorTokenHint)}` : 'Not set';

  el('settings-global-require-token').checked = global.requireOperatorToken !== false;
  el('settings-global-local-writes').checked = global.localWritesOnly !== false;
  el('settings-global-require-approval').checked = global.requireHumanApproval !== false;

  el('settings-imap-host').value = imap.host || '';
  el('settings-imap-port').value = imap.port ? String(imap.port) : '993';
  el('settings-imap-secure').checked = imap.secure !== false;
  el('settings-imap-user').value = imap.user || '';
  el('settings-imap-pass').value = '';
  el('settings-imap-pass-hint').textContent = imap.hasPass ? `Saved: ${maskHint(imap.passHint)}` : 'Not set';
  el('settings-imap-mailbox').value = imap.mailbox || 'INBOX';
  el('settings-imap-sent-mailbox').value = imap.sentMailbox || '';
  el('settings-imap-limit').value = imap.limit ? String(imap.limit) : '200';
  el('settings-imap-since-days').value = imap.sinceDays ? String(imap.sinceDays) : '30';
  el('settings-self-emails').value = imap.selfEmails || '';

  el('settings-gmail-client-id').value = gmail.clientId || '';
  el('settings-gmail-client-secret').value = '';
  el('settings-gmail-client-secret-hint').textContent = gmail.hasClientSecret ? `Saved: ${maskHint(gmail.clientSecretHint)}` : 'Not set';
  el('settings-gmail-status').textContent = gmail.connectedEmail
    ? `Connected as ${gmail.connectedEmail}`
    : (gmail.hasRefreshToken ? 'Connected (email unknown)' : 'Not connected');
  const gmailScopeEl = el('settings-gmail-scope');
  const gmailQueryEl = el('settings-gmail-query');
  const gmailScopeValue = (gmailSync.scope || 'inbox_sent');
  if (gmailScopeEl) gmailScopeEl.value = gmailScopeValue;
  if (gmailQueryEl) {
    gmailQueryEl.value = gmailSync.query || '';
    gmailQueryEl.disabled = gmailScopeValue !== 'custom';
  }

  gmailHasSavedSecret = !!gmail.hasClientSecret;
  gmailHasRefreshToken = !!gmail.hasRefreshToken;
  refreshGmailButtons();

  const setVal = (id, val) => { const e = el(id); if (e) e.value = val; };

  setVal('settings-worker-interval', worker.pollIntervalSeconds ? String(worker.pollIntervalSeconds) : '60');
  setVal('settings-worker-imessage-max', worker.quantities?.imessage !== undefined ? String(worker.quantities.imessage) : '1000');
  setVal('settings-worker-whatsapp-max', worker.quantities?.whatsapp !== undefined ? String(worker.quantities.whatsapp) : '500');
  setVal('settings-worker-gmail-max', worker.quantities?.gmail !== undefined ? String(worker.quantities.gmail) : '100');
  setVal('settings-worker-notes-max', worker.quantities?.notes !== undefined ? String(worker.quantities.notes) : '0');

  setVal('settings-bridge-telegram-mode', bridgeChannels?.telegram?.inboundMode || 'draft_only');
  setVal('settings-bridge-discord-mode', bridgeChannels?.discord?.inboundMode || 'draft_only');
  setVal('settings-bridge-signal-mode', bridgeChannels?.signal?.inboundMode || 'draft_only');
  setVal('settings-bridge-viber-mode', bridgeChannels?.viber?.inboundMode || 'draft_only');
  setVal('settings-bridge-linkedin-mode', bridgeChannels?.linkedin?.inboundMode || 'draft_only');

  setVal('settings-ui-imessage-emoji', channels?.imessage?.emoji || '💬');
  setVal('settings-ui-imessage-me', channels?.imessage?.bubbleMe || '#0a84ff');
  setVal('settings-ui-imessage-contact', channels?.imessage?.bubbleContact || '#262628');
  setVal('settings-ui-whatsapp-emoji', channels?.whatsapp?.emoji || '🟢');
  setVal('settings-ui-whatsapp-me', channels?.whatsapp?.bubbleMe || '#25D366');
  setVal('settings-ui-whatsapp-contact', channels?.whatsapp?.bubbleContact || '#262628');
  setVal('settings-ui-email-emoji', channels?.email?.emoji || '📧');
  setVal('settings-ui-email-me', channels?.email?.bubbleMe || '#5e5ce6');
  setVal('settings-ui-email-contact', channels?.email?.bubbleContact || '#262628');
  setVal('settings-ui-linkedin-emoji', channels?.linkedin?.emoji || '🟦');
  setVal('settings-ui-linkedin-me', channels?.linkedin?.bubbleMe || '#0077b5');
  setVal('settings-ui-linkedin-contact', channels?.linkedin?.bubbleContact || '#262628');

  applyReplyUiSettings(data);
}

async function onSave() {
  const btn = el('settings-save');
  const original = btn?.textContent || 'Save';
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳';
  }

  try {
    const payload = {
      imap: {
        host: el('settings-imap-host').value.trim(),
        port: Number(el('settings-imap-port').value) || 993,
        secure: !!el('settings-imap-secure').checked,
        user: el('settings-imap-user').value.trim(),
        pass: el('settings-imap-pass').value, // optional; empty keeps existing
        mailbox: el('settings-imap-mailbox').value.trim() || 'INBOX',
        sentMailbox: el('settings-imap-sent-mailbox').value.trim(),
        limit: Number(el('settings-imap-limit').value) || 200,
        sinceDays: Number(el('settings-imap-since-days').value) || 30,
        selfEmails: el('settings-self-emails').value.trim(),
      },
      global: {
        googleApiKey: el('settings-global-google-api-key').value,
        operatorToken: el('settings-global-operator-token').value,
        requireOperatorToken: el('settings-global-require-token').checked,
        localWritesOnly: el('settings-global-local-writes').checked,
        requireHumanApproval: el('settings-global-require-approval').checked,
      },
      gmail: {
        clientId: el('settings-gmail-client-id').value.trim(),
        clientSecret: el('settings-gmail-client-secret').value, // optional; empty keeps existing
        sync: {
          scope: el('settings-gmail-scope')?.value || 'inbox_sent',
          query: el('settings-gmail-query')?.value || '',
        },
      },
      worker: {
        pollIntervalSeconds: Number(el('settings-worker-interval').value) || 60,
        quantities: {
          imessage: Number(el('settings-worker-imessage-max').value) || 1000,
          whatsapp: Number(el('settings-worker-whatsapp-max').value) || 500,
          gmail: Number(el('settings-worker-gmail-max').value) || 100,
          notes: Number(el('settings-worker-notes-max').value) || 0,
        }
      },
      channelBridge: {
        channels: {
          telegram: {
            inboundMode: el('settings-bridge-telegram-mode').value || 'draft_only',
          },
          discord: {
            inboundMode: el('settings-bridge-discord-mode').value || 'draft_only',
          },
          signal: {
            inboundMode: el('settings-bridge-signal-mode')?.value || 'draft_only',
          },
          viber: {
            inboundMode: el('settings-bridge-viber-mode')?.value || 'draft_only',
          },
          linkedin: {
            inboundMode: el('settings-bridge-linkedin-mode')?.value || 'draft_only',
          },
        }
      },
      ui: {
        channels: {
          imessage: {
            emoji: el('settings-ui-imessage-emoji')?.value || '💬',
            bubbleMe: el('settings-ui-imessage-me')?.value || '#0a84ff',
            bubbleContact: el('settings-ui-imessage-contact')?.value || '#262628',
          },
          whatsapp: {
            emoji: el('settings-ui-whatsapp-emoji')?.value || '🟢',
            bubbleMe: el('settings-ui-whatsapp-me')?.value || '#25D366',
            bubbleContact: el('settings-ui-whatsapp-contact')?.value || '#262628',
          },
          email: {
            emoji: el('settings-ui-email-emoji')?.value || '📧',
            bubbleMe: el('settings-ui-email-me')?.value || '#5e5ce6',
            bubbleContact: el('settings-ui-email-contact')?.value || '#262628',
          },
          linkedin: {
            emoji: el('settings-ui-linkedin-emoji')?.value || '🟦',
            bubbleMe: el('settings-ui-linkedin-me')?.value || '#0077b5',
            bubbleContact: el('settings-ui-linkedin-contact')?.value || '#262628',
          },
        }
      },
    };

    await saveSettings(payload);
    await loadIntoForm();
    if (btn) {
      btn.textContent = 'Saved';
      setTimeout(() => {
        try { btn.textContent = original; } catch { }
      }, 800);
    }
  } catch (e) {
    console.error('Save settings failed:', e);
    alert(e?.message || 'Save failed');
  } finally {
    if (btn) {
      btn.disabled = false;
      if (btn.textContent === '⏳') btn.textContent = original;
    }
  }
}

async function onConnectGmail() {
  try {
    // If the user just pasted clientId/secret, persist it before starting OAuth.
    const payload = {
      gmail: {
        clientId: el('settings-gmail-client-id')?.value?.trim() || '',
        clientSecret: el('settings-gmail-client-secret')?.value || '',
      },
    };
    await saveSettings(payload);
    await loadIntoForm();

    const { url } = await getGmailAuthUrl();
    window.location.href = url;
  } catch (e) {
    console.error('Connect Gmail failed:', e);
    alert(e?.message || 'Connect Gmail failed');
  }
}

async function onDisconnectGmail() {
  const ok = confirm('Disconnect Gmail from {reply} on this machine?');
  if (!ok) return;
  try {
    await disconnectGmail();
    await loadIntoForm();
  } catch (e) {
    console.error('Disconnect Gmail failed:', e);
    alert(e?.message || 'Disconnect Gmail failed');
  }
}

function setSettingsPageVisible(visible) {
  const page = el('settings-page');
  if (page) page.style.display = visible ? 'flex' : 'none';

  try {
    document.body?.classList?.toggle('mode-settings', !!visible);
    if (visible) document.body?.classList?.remove('mode-dashboard');
  } catch { }

  const messagesEl = el('messages');
  const dashboardEl = el('dashboard');
  const inputArea = document.querySelector('.input-area');
  const chatHeader = document.querySelector('.chat-header');
  if (visible) {
    if (messagesEl) messagesEl.style.display = 'none';
    if (dashboardEl) dashboardEl.style.display = 'none';
    if (inputArea) inputArea.style.display = 'none';
    if (chatHeader) chatHeader.style.display = 'none';
  }
}

export async function openSettings() {
  const dash = el('dashboard');
  previousWasDashboard = !!(dash && dash.style.display !== 'none');
  previousHandleBeforeSettings = previousWasDashboard ? null : (window.currentHandle ?? null);
  setSettingsPageVisible(true);
  applySettingsFilter(null);
  const scroller = el('settings-modal-scroll');
  if (scroller) scroller.scrollTop = 0;
  try {
    await loadIntoForm();
  } catch (e) {
    console.error('Load settings failed:', e);
    alert(e?.message || 'Failed to load settings');
  }
}

export async function openChannelSettings(channel) {
  const key = (channel || '').toString().toLowerCase();
  const normalized = key === 'mail' ? 'email' : key;
  const dash = el('dashboard');
  previousWasDashboard = !!(dash && dash.style.display !== 'none');
  previousHandleBeforeSettings = previousWasDashboard ? null : (window.currentHandle ?? null);
  setSettingsPageVisible(true);
  applySettingsFilter(normalized);
  const scroller = el('settings-modal-scroll');
  if (scroller) scroller.scrollTop = 0;
  try {
    await loadIntoForm();
  } catch (e) {
    console.error('Load settings failed:', e);
    alert(e?.message || 'Failed to load settings');
  }
}

export function closeSettings() {
  setSettingsPageVisible(false);
  applySettingsFilter(null);

  const chatHeader = document.querySelector('.chat-header');
  if (chatHeader) chatHeader.style.display = 'flex';

  const prev = previousHandleBeforeSettings;
  previousHandleBeforeSettings = null;
  const wasDash = previousWasDashboard;
  previousWasDashboard = false;
  if (typeof window.selectContact === 'function') {
    window.selectContact(wasDash ? null : (prev ?? null));
  }
}

function wireDom() {
  const page = el('settings-page');
  if (!page) return;

  document.querySelectorAll('[data-open-channel-settings]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const channel = (btn.getAttribute('data-open-channel-settings') || '').trim();
      if (!channel) return;
      openChannelSettings(channel);
    });
  });

  const btnClose = el('settings-close');
  if (btnClose) btnClose.onclick = closeSettings;

  const btnSave = el('settings-save');
  if (btnSave) btnSave.onclick = () => onSave();

  const gmailConnect = el('settings-gmail-connect');
  if (gmailConnect) gmailConnect.onclick = () => onConnectGmail();
  const gmailDisconnect = el('settings-gmail-disconnect');
  if (gmailDisconnect) gmailDisconnect.onclick = () => onDisconnectGmail();

  const gmailClientId = el('settings-gmail-client-id');
  if (gmailClientId) gmailClientId.addEventListener('input', refreshGmailButtons);
  const gmailClientSecret = el('settings-gmail-client-secret');
  if (gmailClientSecret) gmailClientSecret.addEventListener('input', refreshGmailButtons);

  const gmailScope = el('settings-gmail-scope');
  const gmailQuery = el('settings-gmail-query');
  const refreshGmailSyncInputs = () => {
    if (!gmailScope || !gmailQuery) return;
    const scope = gmailScope.value || 'inbox_sent';
    gmailQuery.disabled = scope !== 'custom';
    gmailQuery.placeholder = scope === 'custom'
      ? 'e.g. label:finance OR from:foo@bar.com'
      : 'Disabled unless scope is Custom';
  };
  if (gmailScope) gmailScope.addEventListener('change', refreshGmailSyncInputs);
  refreshGmailSyncInputs();

  const btnShowAll = el('settings-show-all');
  if (btnShowAll) btnShowAll.onclick = () => applySettingsFilter(null);
}

window.openSettings = openSettings;
window.closeSettings = closeSettings;
window.openChannelSettings = openChannelSettings;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', wireDom);
} else {
  wireDom();
}
