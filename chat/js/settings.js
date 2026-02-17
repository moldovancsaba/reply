import { getSettings, saveSettings, getGmailAuthUrl, disconnectGmail } from './api.js';

function el(id) {
  return document.getElementById(id);
}

let gmailHasSavedSecret = false;
let gmailHasRefreshToken = false;
let currentSettingsFilter = null;

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
          currentSettingsFilter === 'notes' ? 'Notes' :
            currentSettingsFilter === 'email' ? 'Email' :
              'Settings';
    label.textContent = `Configuring: ${name}`;
  }

  // Top-level sections
  const mailSection = el('settings-channel-mail');
  const gmailSection = el('settings-channel-gmail');
  const workerSection = el('settings-section-worker');
  const uiSection = el('settings-section-ui');

  const showAll = !currentSettingsFilter;

  if (showAll) {
    setNodeVisible(mailSection, true);
    setNodeVisible(gmailSection, true);
    setNodeVisible(workerSection, true);
    setNodeVisible(uiSection, true);

    setNodeVisible(el('settings-worker-imessage-wrap'), true);
    setNodeVisible(el('settings-worker-whatsapp-wrap'), true);
    setNodeVisible(el('settings-worker-gmail-wrap'), true);
    setNodeVisible(el('settings-channel-notes'), true);

    setNodeVisible(el('settings-channel-imessage'), true);
    setNodeVisible(el('settings-channel-whatsapp'), true);
    setNodeVisible(el('settings-channel-email'), true);
    return;
  }

  // Always show worker interval when filtering (it’s global)
  setNodeVisible(workerSection, true);
  setNodeVisible(el('settings-worker-interval-wrap'), true);

  if (currentSettingsFilter === 'imessage') {
    setNodeVisible(mailSection, false);
    setNodeVisible(gmailSection, false);
    setNodeVisible(uiSection, true);

    setNodeVisible(el('settings-worker-imessage-wrap'), true);
    setNodeVisible(el('settings-worker-whatsapp-wrap'), false);
    setNodeVisible(el('settings-worker-gmail-wrap'), false);
    setNodeVisible(el('settings-channel-notes'), false);

    setNodeVisible(el('settings-channel-imessage'), true);
    setNodeVisible(el('settings-channel-whatsapp'), false);
    setNodeVisible(el('settings-channel-email'), false);
    return;
  }

  if (currentSettingsFilter === 'whatsapp') {
    setNodeVisible(mailSection, false);
    setNodeVisible(gmailSection, false);
    setNodeVisible(uiSection, true);

    setNodeVisible(el('settings-worker-imessage-wrap'), false);
    setNodeVisible(el('settings-worker-whatsapp-wrap'), true);
    setNodeVisible(el('settings-worker-gmail-wrap'), false);
    setNodeVisible(el('settings-channel-notes'), false);

    setNodeVisible(el('settings-channel-imessage'), false);
    setNodeVisible(el('settings-channel-whatsapp'), true);
    setNodeVisible(el('settings-channel-email'), false);
    return;
  }

  if (currentSettingsFilter === 'notes') {
    setNodeVisible(mailSection, false);
    setNodeVisible(gmailSection, false);
    setNodeVisible(uiSection, false);

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

    setNodeVisible(el('settings-worker-imessage-wrap'), false);
    setNodeVisible(el('settings-worker-whatsapp-wrap'), false);
    setNodeVisible(el('settings-worker-gmail-wrap'), true);
    setNodeVisible(el('settings-channel-notes'), false);

    setNodeVisible(el('settings-channel-imessage'), false);
    setNodeVisible(el('settings-channel-whatsapp'), false);
    setNodeVisible(el('settings-channel-email'), true);
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
  const worker = data?.worker || {};
  const ui = data?.ui || {};
  const channels = ui?.channels || {};

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

  gmailHasSavedSecret = !!gmail.hasClientSecret;
  gmailHasRefreshToken = !!gmail.hasRefreshToken;
  refreshGmailButtons();

  el('settings-worker-interval').value = worker.pollIntervalSeconds ? String(worker.pollIntervalSeconds) : '60';
  el('settings-worker-imessage-max').value = worker.quantities?.imessage !== undefined ? String(worker.quantities.imessage) : '1000';
  el('settings-worker-whatsapp-max').value = worker.quantities?.whatsapp !== undefined ? String(worker.quantities.whatsapp) : '500';
  el('settings-worker-gmail-max').value = worker.quantities?.gmail !== undefined ? String(worker.quantities.gmail) : '100';
  el('settings-worker-notes-max').value = worker.quantities?.notes !== undefined ? String(worker.quantities.notes) : '0';

  el('settings-ui-imessage-emoji').value = channels?.imessage?.emoji || '💬';
  el('settings-ui-imessage-me').value = channels?.imessage?.bubbleMe || '#0a84ff';
  el('settings-ui-imessage-contact').value = channels?.imessage?.bubbleContact || '#262628';
  el('settings-ui-whatsapp-emoji').value = channels?.whatsapp?.emoji || '🟢';
  el('settings-ui-whatsapp-me').value = channels?.whatsapp?.bubbleMe || '#25D366';
  el('settings-ui-whatsapp-contact').value = channels?.whatsapp?.bubbleContact || '#262628';
  el('settings-ui-email-emoji').value = channels?.email?.emoji || '📧';
  el('settings-ui-email-me').value = channels?.email?.bubbleMe || '#5e5ce6';
  el('settings-ui-email-contact').value = channels?.email?.bubbleContact || '#262628';

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
      gmail: {
        clientId: el('settings-gmail-client-id').value.trim(),
        clientSecret: el('settings-gmail-client-secret').value, // optional; empty keeps existing
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
      ui: {
        channels: {
          imessage: {
            emoji: el('settings-ui-imessage-emoji').value,
            bubbleMe: el('settings-ui-imessage-me').value,
            bubbleContact: el('settings-ui-imessage-contact').value,
          },
          whatsapp: {
            emoji: el('settings-ui-whatsapp-emoji').value,
            bubbleMe: el('settings-ui-whatsapp-me').value,
            bubbleContact: el('settings-ui-whatsapp-contact').value,
          },
          email: {
            emoji: el('settings-ui-email-emoji').value,
            bubbleMe: el('settings-ui-email-me').value,
            bubbleContact: el('settings-ui-email-contact').value,
          },
        }
      },
    };

    await saveSettings(payload);
    await loadIntoForm();
    closeSettings();
  } catch (e) {
    console.error('Save settings failed:', e);
    alert(e?.message || 'Save failed');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = original;
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
  const ok = confirm('Disconnect Gmail from Reply on this machine?');
  if (!ok) return;
  try {
    await disconnectGmail();
    await loadIntoForm();
  } catch (e) {
    console.error('Disconnect Gmail failed:', e);
    alert(e?.message || 'Disconnect Gmail failed');
  }
}

export async function openSettings() {
  const overlay = el('settings-modal');
  setVisible(overlay, true);
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
  const overlay = el('settings-modal');
  setVisible(overlay, true);
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
  const overlay = el('settings-modal');
  setVisible(overlay, false);
  applySettingsFilter(null);
}

function wireDom() {
  const overlay = el('settings-modal');
  if (!overlay) return;

  // click outside closes
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeSettings();
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
