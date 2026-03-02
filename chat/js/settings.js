import { getSettings, saveSettings, getGmailAuthUrl, disconnectGmail } from './api.js';

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
    security: 'Privacy & Security'
  };
  const titleEl = el('settings-tab-title');
  if (titleEl) titleEl.textContent = titles[tabId] || 'Settings';
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
      worker: {
        pollIntervalSeconds: Number(el('settings-worker-interval')?.value) || 60,
        quantities: {
          imessage: Number(el('settings-worker-imessage-max')?.value) || 1000,
          whatsapp: Number(el('settings-worker-whatsapp-max')?.value) || 500,
          gmail: Number(el('settings-worker-gmail-max')?.value) || 100,
          notes: Number(el('settings-worker-notes-max')?.value) || 0,
        }
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

  // If standalone, navigate back
  if (window.location.pathname.includes('settings.html')) {
    window.location.href = 'index.html';
    return;
  }

  if (typeof window.selectContact === 'function') {
    window.selectContact(window.currentHandle || null);
  }
}

/**
 * Wire DOM events for settings
 */
export async function wireDom() {
  const container = document.getElementById('settings-container');
  if (!container) return;

  // Lazy load the settings fragment if not already loaded
  if (!container.innerHTML.trim()) {
    try {
      const response = await fetch('fragments/settings-fragment.html');
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
  el('settings-gmail-connect').onclick = onConnectGmail;
  el('settings-gmail-disconnect').onclick = onDisconnectGmail;

  navItems.forEach(btn => {
    btn.onclick = () => switchTab(btn.getAttribute('data-tab'));
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
