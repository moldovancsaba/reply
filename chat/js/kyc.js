/**
 * {reply} - KYC Module
 * Loads/saves the contact profile shown in the right pane.
 */
import { createPlatformValueNode, resolvePlatformTarget } from './platform-icons.js';

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    let detail = '';
    try {
      const raw = await res.text();
      try {
        const parsed = JSON.parse(raw);
        detail = [parsed?.error, parsed?.message, parsed?.hint]
          .map((v) => String(v || '').trim())
          .filter(Boolean)
          .join(' ');
      } catch {
        detail = String(raw || '').trim();
      }
    } catch {
      detail = '';
    }
    throw new Error(detail || `${res.status} ${res.statusText}`);
  }
  return await res.json();
}

function el(id) {
  return document.getElementById(id);
}

function buildSecurityHeaders(overrides = null) {
  const headers = { 'X-Reply-Human-Approval': 'confirmed' };
  if (overrides && typeof overrides === 'object') {
    Object.assign(headers, overrides);
  }
  const token = (window.localStorage && window.localStorage.getItem('replyOperatorToken')) || window.REPLY_OPERATOR_TOKEN;
  if (token) headers['X-Reply-Operator-Token'] = token;
  return headers;
}

function withApproval(payload, source) {
  return {
    ...(payload || {}),
    approval: {
      confirmed: true,
      source: source || 'ui',
      at: new Date().toISOString(),
    },
  };
}

function setVisible(element, visible) {
  if (!element) return;
  element.style.display = visible ? 'block' : 'none';
}

function renderHandlePreview(handle) {
  const input = el('kyc-handle-input');
  const parent = input?.parentElement;
  if (!input || !parent) return;

  let preview = el('kyc-handle-preview');
  if (!preview) {
    preview = document.createElement('div');
    preview.id = 'kyc-handle-preview';
    preview.className = 'kyc-handle-preview';
    parent.appendChild(preview);
  }
  preview.innerHTML = '';

  const value = String(handle || '').trim();
  if (!value) return;
  const node = createPlatformValueNode(value, {
    channelHint: 'handle',
    showText: true,
    showIcon: true,
    showFallbackIcon: true,
    className: 'kyc-handle-link',
  });
  preview.appendChild(node);
}

function createEmptyRow(text) {
  const row = document.createElement('div');
  row.className = 'kyc-empty-row';
  row.textContent = text;
  return row;
}

function renderNotes(notes) {
  const log = el('notes-log');
  if (!log) return;

  log.innerHTML = '';

  const items = Array.isArray(notes) ? [...notes] : [];
  items.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));

  if (items.length === 0) {
    log.appendChild(createEmptyRow('No notes yet.'));
    return;
  }

  for (const n of items) {
    const row = document.createElement('div');
    row.className = 'kyc-note-row';

    const left = document.createElement('div');
    left.className = 'kyc-note-left';

    const kind = String(n.kind || 'note').toLowerCase();
    const header = (kind && kind !== 'note') ? document.createElement('div') : null;
    if (header) {
      header.className = 'kyc-note-header';
      const tag = document.createElement('div');
      tag.className = 'kyc-note-tag';
      const label = kind === 'link' ? 'LINK'
        : (kind === 'email' ? 'EMAIL'
          : (kind === 'phone' ? 'PHONE'
            : (kind === 'address' ? 'ADDRESS'
              : (kind === 'hashtag' ? 'HASHTAG' : kind.toUpperCase()))));
      tag.textContent = label;
      header.appendChild(tag);
    }

    const text = document.createElement('div');
    text.className = 'kyc-note-text kyc-note-text--editable';
    const noteValue = (n.value ?? n.text ?? '').toString();
    const target = resolvePlatformTarget(noteValue, { channelHint: kind });
    if (target.href || kind !== 'note') {
      const node = createPlatformValueNode(noteValue, {
        channelHint: kind,
        showText: true,
        showIcon: true,
        showFallbackIcon: kind !== 'note',
        className: 'kyc-note-link',
      });
      text.appendChild(node);
    } else {
      text.textContent = noteValue;
    }
    text.title = 'Click to edit';

    const meta = document.createElement('div');
    meta.className = 'kyc-note-meta';
    const created = n.timestamp ? new Date(n.timestamp).toLocaleString() : '';
    const edited = n.editedAt ? `Edited ${new Date(n.editedAt).toLocaleString()}` : '';
    meta.textContent = [created, edited].filter(Boolean).join(' • ');

    if (header) left.appendChild(header);
    left.appendChild(text);
    if (meta.textContent) left.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'kyc-note-actions';

    const del = document.createElement('button');
    del.textContent = '✕';
    del.title = 'Delete note';
    del.className = 'kyc-note-delete';
    del.onclick = () => window.deleteNote?.(n.id);
    actions.appendChild(del);

    const startEdit = () => {
      const handle = el('kyc-handle-input')?.value?.trim();
      if (!handle) return;

      const editor = document.createElement('textarea');
      editor.className = 'kyc-note-editor';
      editor.value = n.text || '';
      editor.rows = 1;

      const autoResize = () => {
        editor.style.height = 'auto';
        editor.style.height = `${Math.min(editor.scrollHeight, 140)}px`;
        editor.style.overflowY = editor.scrollHeight > 140 ? 'auto' : 'hidden';
      };
      editor.addEventListener('input', autoResize);

      const save = async () => {
        const next = editor.value.trim();
        if (!next) return;
        await fetchJson('/api/update-note', {
          method: 'POST',
          headers: buildSecurityHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(withApproval({ handle, id: n.id, text: next }, 'ui-update-note')),
        });
        await loadKYCData(handle);
      };

      const cancel = () => {
        // Re-render without refetching by restoring the original DOM.
        left.innerHTML = '';
        if (header) left.appendChild(header);
        left.appendChild(text);
        if (meta.textContent) left.appendChild(meta);
        actions.innerHTML = '';
        actions.appendChild(del);
      };

      const btnSave = document.createElement('button');
      btnSave.className = 'btn btn-secondary btn-icon btn-icon-sm kyc-note-save';
      btnSave.textContent = '✓';
      btnSave.title = 'Save (Enter)';
      btnSave.onclick = () => save().catch((e) => alert(`Save failed: ${e.message}`));

      const btnCancel = document.createElement('button');
      btnCancel.className = 'btn btn-secondary btn-icon btn-icon-sm kyc-note-cancel';
      btnCancel.textContent = '↩︎';
      btnCancel.title = 'Cancel (Esc)';
      btnCancel.onclick = cancel;

      editor.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          cancel();
          return;
        }
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          save().catch((err) => alert(`Save failed: ${err.message}`));
        }
      });

      left.innerHTML = '';
      if (header) left.appendChild(header);
      left.appendChild(editor);
      actions.innerHTML = '';
      actions.appendChild(btnSave);
      actions.appendChild(btnCancel);
      actions.appendChild(del);

      autoResize();
      editor.focus();
      editor.setSelectionRange(editor.value.length, editor.value.length);
    };

    text.addEventListener('click', (e) => {
      if (e.target instanceof Element && e.target.closest('a')) return;
      startEdit();
    });

    row.appendChild(left);
    row.appendChild(actions);
    log.appendChild(row);
  }
}

function renderChannels(channels) {
  const root = el('kyc-channels');
  if (!root) return;
  root.innerHTML = '';

  const phone = Array.isArray(channels?.phone) ? channels.phone : [];
  const email = Array.isArray(channels?.email) ? channels.email : [];

  if (phone.length === 0 && email.length === 0) {
    root.appendChild(createEmptyRow('No channels saved.'));
    return;
  }

  const wrap = document.createElement('div');
  wrap.className = 'kyc-chip-wrap';

  const addChip = (label, value, channelHint) => {
    const chip = createPlatformValueNode(value, {
      channelHint,
      showText: false,
      showIcon: true,
      showFallbackIcon: true,
      className: 'kyc-chip',
    });
    const labelEl = document.createElement('span');
    labelEl.textContent = `${label}:`;
    const valueEl = document.createElement('span');
    valueEl.textContent = value;
    chip.appendChild(labelEl);
    chip.appendChild(valueEl);
    chip.title = value;
    wrap.appendChild(chip);
  };

  for (const p of phone) addChip('Phone', p, 'phone');
  for (const e of email) addChip('Email', e, 'email');

  root.appendChild(wrap);
}

function renderSuggestions(handle, pendingSuggestions) {
  const root = el('kyc-suggestions');
  if (!root) return;
  root.innerHTML = '';

  const suggestions = Array.isArray(pendingSuggestions) ? pendingSuggestions : [];
  if (suggestions.length === 0) {
    root.appendChild(createEmptyRow('No pending suggestions.'));
    return;
  }

  const list = document.createElement('div');
  list.className = 'kyc-sugg-list';

  for (const s of suggestions) {
    const row = document.createElement('div');
    row.className = 'kyc-sugg-row';

    const header = document.createElement('div');
    header.className = 'kyc-sugg-header';

    const tag = document.createElement('div');
    tag.className = 'kyc-sugg-tag';
    const kind = String(s.type || 'suggestion').toLowerCase();
    const label =
      kind === 'links' ? 'LINK' :
        kind === 'emails' ? 'EMAIL' :
          kind === 'phones' ? 'PHONE' :
            kind === 'addresses' ? 'ADDRESS' :
              kind === 'hashtags' ? 'HASHTAG' :
                kind === 'notes' ? 'NOTE' :
                  String(s.type || 'SUGGESTION').toUpperCase();
    tag.textContent = label;

    const actions = document.createElement('div');
    actions.className = 'kyc-sugg-actions';

    const accept = document.createElement('button');
    accept.className = 'btn btn-secondary btn-sm kyc-sugg-accept';
    accept.textContent = 'Accept';
    accept.onclick = async () => {
      await fetchJson('/api/accept-suggestion', {
        method: 'POST',
        headers: buildSecurityHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(withApproval({ handle, id: s.id }, 'ui-accept-suggestion')),
      });
      await loadKYCData(handle);
    };

    const decline = document.createElement('button');
    decline.className = 'btn btn-secondary btn-sm kyc-sugg-decline';
    decline.textContent = 'Decline';
    decline.onclick = async () => {
      await fetchJson('/api/decline-suggestion', {
        method: 'POST',
        headers: buildSecurityHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(withApproval({ handle, id: s.id }, 'ui-decline-suggestion')),
      });
      await loadKYCData(handle);
    };

    actions.appendChild(accept);
    actions.appendChild(decline);

    header.appendChild(tag);
    header.appendChild(actions);

    const content = document.createElement('div');
    content.className = 'kyc-sugg-content';
    const suggValue = (s.content || '').toString();
    const valueNode = createPlatformValueNode(suggValue, {
      channelHint: kind,
      showText: true,
      showIcon: true,
      showFallbackIcon: kind !== 'notes',
      className: 'kyc-sugg-link',
    });
    content.appendChild(valueNode);

    const meta = document.createElement('div');
    meta.className = 'kyc-sugg-meta';
    const time = s.timestamp ? new Date(s.timestamp).toLocaleString() : '';
    meta.textContent = time;

    row.appendChild(header);
    row.appendChild(content);
    if (meta.textContent) row.appendChild(meta);
    list.appendChild(row);
  }

  root.appendChild(list);
}

function updateChannelOptionsFromKyc(handle, channels) {
  const sel = document.getElementById('channel-select');
  if (!sel) return;

  const phone = Array.isArray(channels?.phone) ? channels.phone : [];
  const email = Array.isArray(channels?.email) ? channels.email : [];

  const available = new Set();
  if (phone.length > 0 || (handle && !String(handle).includes('@'))) {
    available.add('imessage');
    available.add('whatsapp');
  }
  if (email.length > 0 || (handle && String(handle).includes('@'))) {
    available.add('email');
  }

  Array.from(sel.options).forEach(o => {
    o.disabled = !available.has(o.value);
    o.hidden = !available.has(o.value);
  });

  // If current selection is no longer available, pick a sensible default.
  if (!available.has(sel.value)) {
    const preferred = (window.currentChannel || '').toString().toLowerCase();
    const pick = available.has(preferred)
      ? preferred
      : (available.has('imessage') ? 'imessage' : (available.values().next().value || 'imessage'));
    sel.value = pick;
    window.setSelectedChannel?.(pick);
  }
}

export async function loadKYCData(handle) {
  const emptyState = el('kyc-empty-state');
  const editor = el('kyc-content-editor');

  if (!handle) {
    setVisible(emptyState, true);
    setVisible(editor, false);
    return;
  }

  setVisible(emptyState, false);
  setVisible(editor, true);

  const nameInput = el('kyc-name-input');
  const roleInput = el('kyc-role-input');
  const relInput = el('kyc-rel-input');
  const handleInput = el('kyc-handle-input');

  if (handleInput) handleInput.value = handle;
  renderHandlePreview(handle);

  // Loading state
  if (nameInput) nameInput.placeholder = 'Loading...';
  if (roleInput) roleInput.placeholder = 'Loading...';
  if (relInput) relInput.placeholder = 'Loading...';

  try {
    const data = await fetchJson(`/api/kyc?handle=${encodeURIComponent(handle)}`, {
      headers: buildSecurityHeaders()
    });
    if (nameInput) {
      nameInput.value = data.displayName || '';
      nameInput.placeholder = 'Display Name';
    }
    if (roleInput) {
      roleInput.value = data.profession || '';
      roleInput.placeholder = 'Profession / Role';
    }
    if (relInput) {
      relInput.value = data.relationship || '';
      relInput.placeholder = 'Relationship';
    }
    renderNotes(data.notes);
    renderChannels(data.channels);
    renderSuggestions(handle, data.pendingSuggestions);
    updateChannelOptionsFromKyc(handle, data.channels);
  } catch (e) {
    console.warn('Failed to load KYC:', e);
    if (nameInput) {
      nameInput.value = '';
      nameInput.placeholder = 'Display Name';
    }
    if (roleInput) {
      roleInput.value = '';
      roleInput.placeholder = 'Profession / Role';
    }
    if (relInput) {
      relInput.value = '';
      relInput.placeholder = 'Relationship';
    }
    renderHandlePreview(handle);
    renderNotes([]);
    renderChannels(null);
    renderSuggestions(handle, []);
    updateChannelOptionsFromKyc(handle, null);
  }
}

export async function saveInlineProfile(btn = null) {
  const originalText = btn ? btn.textContent : null;
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Saving...';
  }

  try {
    const handle = el('kyc-handle-input')?.value?.trim();
    if (!handle) return;

    const payload = {
      handle,
      displayName: el('kyc-name-input')?.value?.trim() || '',
      profession: el('kyc-role-input')?.value?.trim() || '',
      relationship: el('kyc-rel-input')?.value?.trim() || '',
    };

    const result = await fetchJson('/api/kyc', {
      method: 'POST',
      headers: buildSecurityHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(withApproval(payload, 'ui-save-kyc')),
    });

    if (result?.status !== 'ok') throw new Error(result?.error || 'Failed to save');

    const display = payload.displayName || handle;

    const header = document.getElementById('active-contact-name-chat');
    if (header) header.textContent = display;

    const escapeAttrValue = (value) => String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const selector = `.sidebar-item[data-handle="${escapeAttrValue(handle)}"]`;

    // Update sidebar item label immediately (best-effort)
    const nameEl = document.querySelector(`${selector} .contact-name`);
    if (nameEl) nameEl.textContent = display;

    // Update in-memory cache used by contacts.js
    if (Array.isArray(window.conversations)) {
      const contact = window.conversations.find((c) => c && c.handle === handle);
      if (contact) contact.displayName = display;
    }

    // Refresh from server so sidebar ordering/preview stays correct
    if (typeof window.loadConversations === 'function') {
      try {
        await window.loadConversations(false);
        // Restore active highlight
        const activeItem = document.querySelector(selector);
        if (activeItem) activeItem.classList.add('active');
      } catch (e) {
        console.warn('Failed to refresh conversations after save:', e);
      }
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }
}

export async function addNote() {
  const handle = el('kyc-handle-input')?.value?.trim();
  const input = el('new-note-input');
  const text = input?.value?.trim();
  if (!handle || !text) return;

  await fetchJson('/api/add-note', {
    method: 'POST',
    headers: buildSecurityHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(withApproval({ handle, text }, 'ui-add-note')),
  });

  input.value = '';
  await loadKYCData(handle);
}

export async function deleteNote(id) {
  const handle = el('kyc-handle-input')?.value?.trim();
  if (!handle || !id) return;
  await fetchJson(`/api/delete-note?handle=${encodeURIComponent(handle)}&id=${encodeURIComponent(id)}`, {
    method: 'GET',
    headers: buildSecurityHeaders(),
  });
  await loadKYCData(handle);
}

export function dismissKYC() {
  const alert = el('suggested-kyc-alert');
  if (alert) alert.style.display = 'none';
}

async function analyzeContact(handle) {
  await fetchJson('/api/analyze-contact', {
    method: 'POST',
    headers: buildSecurityHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(withApproval({ handle }, 'ui-analyze-contact')),
  });
  await loadKYCData(handle);
}

export async function saveProfile(btn = null) {
  const originalText = btn ? btn.textContent : null;
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Saving...';
  }

  try {
    const handle = el('prof-handle')?.value?.trim();
    if (!handle) return;

    const payload = {
      handle,
      displayName: el('prof-name')?.value?.trim() || '',
      profession: el('prof-role')?.value?.trim() || '',
      relationship: el('prof-rel')?.value?.trim() || '',
    };

    const result = await fetchJson('/api/kyc', {
      method: 'POST',
      headers: buildSecurityHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(withApproval(payload, 'ui-save-profile-modal')),
    });

    if (result?.status !== 'ok') throw new Error(result?.error || 'Failed to save');

    // Close modal and refresh UI
    closeProfileModal();
    await loadKYCData(handle);

    // Refresh sidebar
    if (typeof window.loadConversations === 'function') {
      try {
        await window.loadConversations(false);
      } catch (e) {
        console.warn('Failed to refresh conversations after save:', e);
      }
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }
}

export function closeProfileModal() {
  const modal = el('profile-modal');
  if (modal) modal.style.display = 'none';
}

// Exposure to global scope for HTML onclick handlers
window.saveInlineProfile = async (btn) => {
  try {
    console.log('[KYC] saveInlineProfile() triggered', { btn: !!btn });
    await saveInlineProfile(btn);
    console.log('[KYC] saveInlineProfile() success');
  } catch (e) {
    console.error('[KYC] saveInlineProfile() ERROR:', e);
    alert(`Save failed: ${e.message}`);
  }
};

window.saveProfile = async (btn) => {
  try {
    console.log('[KYC] saveProfile() triggered', { btn: !!btn });
    await saveProfile(btn);
    console.log('[KYC] saveProfile() success');
  } catch (e) {
    console.error('[KYC] saveProfile() ERROR:', e);
    alert(`Save failed: ${e.message}`);
  }
};

window.closeProfileModal = closeProfileModal;
window.addNote = () => addNote().catch((e) => console.error('Add note failed:', e));
window.deleteNote = (id) => deleteNote(id).catch((e) => console.error('Delete note failed:', e));
window.loadKYCData = loadKYCData;
window.dismissKYC = dismissKYC;
window.acceptKYC = dismissKYC;
window.editKYC = dismissKYC;

// Wire Analyze button (exists only when profile editor is visible)
function wireAnalyzeButton() {
  const btn = document.getElementById('btn-deep-analyze');
  if (!btn) return;
  btn.onclick = async () => {
    const handle = document.getElementById('kyc-handle-input')?.value?.trim();
    if (!handle) return;
    const original = btn.textContent;
    try {
      btn.disabled = true;
      btn.textContent = '⏳';
      await analyzeContact(handle);
    } catch (e) {
      console.error('Analyze failed:', e);
      alert(`Analyze failed: ${e.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  };
}

function wireLocalIntelligenceInput() {
  const input = document.getElementById('new-note-input');
  if (!input) return;
  if (input.dataset.wired === '1') return;
  input.dataset.wired = '1';
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    window.addNote?.();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    wireAnalyzeButton();
    wireLocalIntelligenceInput();
  });
} else {
  wireAnalyzeButton();
  wireLocalIntelligenceInput();
}
