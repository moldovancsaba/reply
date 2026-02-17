/**
 * {reply} - KYC Module
 * Loads/saves the contact profile shown in the right pane.
 */

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return await res.json();
}

function el(id) {
  return document.getElementById(id);
}

function setVisible(element, visible) {
  if (!element) return;
  element.style.display = visible ? 'block' : 'none';
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
    text.textContent = n.text || '';
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
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ handle, id: n.id, text: next }),
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

    text.onclick = startEdit;

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

  const addChip = (label, value) => {
    const chip = document.createElement('div');
    chip.className = 'kyc-chip';
    chip.title = value;
    chip.textContent = `${label}: ${value}`;
    wrap.appendChild(chip);
  };

  for (const p of phone) addChip('📞', p);
  for (const e of email) addChip('📧', e);

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
    tag.textContent = s.type ? String(s.type) : 'suggestion';

    const actions = document.createElement('div');
    actions.className = 'kyc-sugg-actions';

    const accept = document.createElement('button');
    accept.className = 'btn btn-secondary btn-sm kyc-sugg-accept';
    accept.textContent = 'Accept';
    accept.onclick = async () => {
      await fetchJson('/api/accept-suggestion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle, id: s.id }),
      });
      await loadKYCData(handle);
    };

    const decline = document.createElement('button');
    decline.className = 'btn btn-secondary btn-sm kyc-sugg-decline';
    decline.textContent = 'Decline';
    decline.onclick = async () => {
      await fetchJson('/api/decline-suggestion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle, id: s.id }),
      });
      await loadKYCData(handle);
    };

    actions.appendChild(accept);
    actions.appendChild(decline);

    header.appendChild(tag);
    header.appendChild(actions);

    const content = document.createElement('div');
    content.className = 'kyc-sugg-content';
    content.textContent = s.content || '';

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

  try {
    const data = await fetchJson(`/api/kyc?handle=${encodeURIComponent(handle)}`);
    if (nameInput) nameInput.value = data.displayName || '';
    if (roleInput) roleInput.value = data.profession || '';
    if (relInput) relInput.value = data.relationship || '';
    renderNotes(data.notes);
    renderChannels(data.channels);
    renderSuggestions(handle, data.pendingSuggestions);
    updateChannelOptionsFromKyc(handle, data.channels);
  } catch (e) {
    console.warn('Failed to load KYC:', e);
    if (nameInput) nameInput.value = '';
    if (roleInput) roleInput.value = '';
    if (relInput) relInput.value = '';
    renderNotes([]);
    renderChannels(null);
    renderSuggestions(handle, []);
    updateChannelOptionsFromKyc(handle, null);
  }
}

export async function saveInlineProfile() {
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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
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
}

export async function addNote() {
  const handle = el('kyc-handle-input')?.value?.trim();
  const input = el('new-note-input');
  const text = input?.value?.trim();
  if (!handle || !text) return;

  await fetchJson('/api/add-note', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ handle, text }),
  });

  input.value = '';
  await loadKYCData(handle);
}

export async function deleteNote(id) {
  const handle = el('kyc-handle-input')?.value?.trim();
  if (!handle || !id) return;
  await fetchJson(`/api/delete-note?handle=${encodeURIComponent(handle)}&id=${encodeURIComponent(id)}`);
  await loadKYCData(handle);
}

export function dismissKYC() {
  const alert = el('suggested-kyc-alert');
  if (alert) alert.style.display = 'none';
}

async function analyzeContact(handle) {
  await fetchJson('/api/analyze-contact', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ handle }),
  });
  await loadKYCData(handle);
}

// Export to window for inline handlers in chat/index.html
window.loadKYCData = loadKYCData;
window.saveInlineProfile = async () => {
  try {
    await saveInlineProfile();
  } catch (e) {
    console.error('Save profile failed:', e);
    alert(`Save failed: ${e.message}`);
  }
};
window.addNote = () => addNote().catch((e) => console.error('Add note failed:', e));
window.deleteNote = (id) => deleteNote(id).catch((e) => console.error('Delete note failed:', e));
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
