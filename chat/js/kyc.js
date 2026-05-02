/**
 * {reply} - KYC Module
 * Loads/saves the contact profile shown in the right pane.
 */
import { createPlatformValueNode, resolvePlatformTarget } from './platform-icons.js';
import { UI } from './ui.js';
import { setMaterialIcon } from './icon-fallback.js';

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

function setIconButtonBusyState(btn, { busy, busyIcon = 'info', idleIcon, busyLabel, idleLabel, busyTooltip, idleTooltip }) {
  if (!btn) return;
  const icon = btn.querySelector('.reply-shell-icon');
  const label = btn.querySelector('.shell-toolbar-button__label, .shell-action-button__label');
  btn.disabled = !!busy;
  setMaterialIcon(icon, busy ? busyIcon : idleIcon);
  if (label) label.textContent = busy ? busyLabel : idleLabel;
  btn.setAttribute('aria-label', busy ? busyTooltip : idleTooltip);
  btn.dataset.tooltip = busy ? busyTooltip : idleTooltip;
}

/** Show merged alias rows for this canonical profile (reply#19). */
async function refreshKycAliasStrip(forKey) {
  const strip = el('kyc-alias-strip');
  const list = el('kyc-alias-list');
  if (!strip || !list) return;
  if (!forKey) {
    strip.classList.add('u-display-none');
    list.innerHTML = '';
    return;
  }
  try {
    const { listContactAliases } = await import('./api.js');
    const data = await listContactAliases(forKey);
    const aliases = data.aliases || [];
    list.innerHTML = '';
    if (!aliases.length) {
      strip.classList.add('u-display-none');
      return;
    }
    strip.classList.remove('u-display-none');
    for (const a of aliases) {
      const li = document.createElement('li');
      li.style.marginBottom = '4px';
      const label = document.createElement('span');
      const h = a.handle || a.id;
      label.textContent = `${a.presentationDisplayName || a.displayName || h} (${h})`;
      li.appendChild(label);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-ghost btn-sm';
      btn.style.marginLeft = '8px';
      btn.textContent = 'Unlink';
      btn.onclick = () => {
        unlinkKycAlias(a.id, forKey).catch((e) => console.error(e));
      };
      li.appendChild(btn);
      list.appendChild(li);
    }
  } catch (e) {
    console.warn('aliases strip:', e);
    strip.classList.add('u-display-none');
  }
}

async function unlinkKycAlias(aliasId, forKey) {
  const { unlinkContactAlias } = await import('./api.js');
  await unlinkContactAlias(aliasId);
  UI.showToast('Alias unlinked', 'success', 2200);
  await refreshKycAliasStrip(forKey);
  if (typeof window.loadConversations === 'function') {
    try {
      await window.loadConversations(false);
    } catch (err) {
      console.warn('refresh conversations after unlink', err);
    }
  }
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

function visibilityLabel(state) {
  const key = String(state || 'active').toLowerCase();
  if (key === 'archived') return 'Archived';
  if (key === 'removed') return 'Removed';
  if (key === 'blocked') return 'Blocked';
  return 'Active';
}

function renderProfileVisibilityState(data) {
  const badge = el('kyc-visibility-badge');
  const note = el('kyc-visibility-note');
  if (!badge || !note) return;
  const state = String(data?.visibilityState || 'active').toLowerCase();
  badge.textContent = visibilityLabel(state);
  badge.className = `kyc-visibility-badge is-${state}`;
  if (state === 'archived') {
    note.textContent = 'Hidden from {reply} until a new inbound message arrives.';
  } else if (state === 'removed') {
    note.textContent = 'Hidden from {reply}. Historical data remains available for annotation.';
  } else if (state === 'blocked') {
    note.textContent = 'Hidden from {reply} and excluded from annotation and analysis.';
  } else {
    note.textContent = 'Visible in {reply}.';
  }
}

function closeProfileActionsMenu() {
  el('profile-actions-menu')?.classList.add('u-display-none');
}

function toggleProfileActionsMenu() {
  const menu = el('profile-actions-menu');
  if (!menu) return;
  menu.classList.toggle('u-display-none');
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
          body: JSON.stringify(withApproval({
            handle,
            id: n.id,
            text: next,
            kind: n.kind || 'note'
          }, 'ui-update-note')),
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

async function persistChannels(mutator) {
  const handle = el('kyc-handle-input')?.value?.trim();
  if (!handle) return;
  const cur = await fetchJson(`/api/kyc?handle=${encodeURIComponent(handle)}`, {
    headers: buildSecurityHeaders()
  });
  const base = { phone: [], email: [], ...(cur.channels || {}) };
  mutator(base);
  await fetchJson('/api/kyc', {
    method: 'POST',
    headers: buildSecurityHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(withApproval({ handle, channels: base }, 'ui-channels'))
  });
  await loadKYCData(handle);
}

function renderChannels(channels) {
  const root = el('kyc-channels');
  if (!root) return;
  root.innerHTML = '';

  const phone = Array.isArray(channels?.phone) ? channels.phone : [];
  const email = Array.isArray(channels?.email) ? channels.email : [];

  const wrap = document.createElement('div');
  wrap.className = 'kyc-channel-editor';

  const list = document.createElement('div');
  list.className = 'kyc-channel-list';

  const row = (label, value, kind, onRemove) => {
    const r = document.createElement('div');
    r.className = 'kyc-channel-row';
    const chip = createPlatformValueNode(value, {
      channelHint: kind,
      showText: true,
      showIcon: true,
      showFallbackIcon: true,
      className: 'kyc-chip kyc-chip--row'
    });
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'btn btn-ghost btn-sm kyc-channel-remove';
    rm.textContent = 'Remove';
    rm.title = `Remove ${label}`;
    rm.onclick = () => onRemove().catch((e) => UI.showToast(e.message || 'Remove failed', 'error'));
    r.appendChild(chip);
    r.appendChild(rm);
    list.appendChild(r);
  };

  phone.forEach((p) =>
    row('Phone', p, 'phone', async () => {
      await persistChannels((ch) => {
        ch.phone = (ch.phone || []).filter((x) => x !== p);
      });
    })
  );
  email.forEach((em) =>
    row('Email', em, 'email', async () => {
      await persistChannels((ch) => {
        ch.email = (ch.email || []).filter((x) => x !== em);
      });
    })
  );

  if (phone.length === 0 && email.length === 0) {
    list.appendChild(createEmptyRow('No phone/email rows yet — add below.'));
  }

  const addBar = document.createElement('div');
  addBar.className = 'kyc-channel-add';
  const typeSel = document.createElement('select');
  typeSel.className = 'kyc-channel-add-type';
  typeSel.innerHTML = '<option value="phone">Phone</option><option value="email">Email</option>';
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'kyc-field-input kyc-channel-add-input';
  inp.placeholder = '+36… or name@domain';
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn btn-secondary btn-sm';
  addBtn.textContent = 'Add';
  addBtn.onclick = async () => {
    const v = inp.value.trim();
    if (!v) return;
    const t = typeSel.value === 'email' ? 'email' : 'phone';
    try {
      await persistChannels((ch) => {
        const key = t === 'email' ? 'email' : 'phone';
        if (!ch[key]) ch[key] = [];
        if (!ch[key].includes(v)) ch[key].push(v);
      });
      inp.value = '';
    } catch (e) {
      UI.showToast(e.message || 'Add failed', 'error');
    }
  };
  addBar.appendChild(typeSel);
  addBar.appendChild(inp);
  addBar.appendChild(addBtn);

  wrap.appendChild(list);
  wrap.appendChild(addBar);
  root.appendChild(wrap);
}

function renderConnectedServices(data, handle) {
  const root = el('kyc-connected-services');
  if (!root) return;
  root.innerHTML = '';

  const channels = data?.channels || {};
  const phone = Array.isArray(channels.phone) ? channels.phone : [];
  const email = Array.isArray(channels.email) ? channels.email : [];

  const services = [];

  const hasPhone = phone.length > 0 || (handle && !String(handle).includes('@') && String(handle).match(/^\\+?\\d+$/));
  const hasEmail = email.length > 0 || (handle && String(handle).includes('@'));

  if (hasPhone) {
    services.push({ id: 'whatsapp', label: 'WhatsApp', value: 'whatsapp' });
    services.push({ id: 'imessage', label: 'iMessage', value: 'imessage' });
  }
  if (hasEmail) {
    services.push({ id: 'email', label: 'Email', value: 'email' });
  }
  if (data?.linkedinUrl) {
    services.push({ id: 'linkedin', label: 'LinkedIn', value: data.linkedinUrl });
  }

  if (services.length === 0) {
    root.appendChild(createEmptyRow('No known connected services.'));
    return;
  }

  const wrap = document.createElement('div');
  wrap.className = 'kyc-chip-wrap';

  for (const svc of services) {
    // We use the platform icons function to render nice chips
    const chip = createPlatformValueNode(svc.value, {
      channelHint: svc.id,
      showText: false,
      showIcon: true,
      showFallbackIcon: true,
      className: 'kyc-chip',
    });
    const labelEl = document.createElement('span');
    labelEl.textContent = svc.label;
    chip.appendChild(labelEl);
    chip.title = svc.label;
    wrap.appendChild(chip);
  }

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
      kind.includes('nba') ? 'ACTION' :
        kind === 'draft' ? 'DRAFT' :
          kind === 'links' ? 'LINK' :
            kind === 'emails' ? 'EMAIL' :
              kind === 'phones' ? 'PHONE' :
                kind === 'addresses' ? 'ADDRESS' :
                  kind === 'hashtags' ? 'HASHTAG' :
                    kind === 'notes' ? 'NOTE' :
                      String(s.type || 'SUGGESTION').toUpperCase();
    tag.textContent = label;
    if (label === 'ACTION') tag.style.background = 'var(--primary-color)';
    if (label === 'DRAFT') tag.style.background = 'var(--secondary-color)';

    const actions = document.createElement('div');
    actions.className = 'kyc-sugg-actions';

    const accept = document.createElement('button');
    accept.className = 'btn btn-secondary btn-sm kyc-sugg-accept';
    accept.textContent = 'Accept';
    accept.onclick = async () => {
      // Specialized handling for NBA/Draft actions
      const typeStr = String(s.type || '').toUpperCase();
      const content = s.content || '';

      if (typeStr.includes('DRAFT') || typeStr.includes('NBA')) {
        const chatInput = document.getElementById('chat-input');
        if (chatInput) {
          // If it's a draft or a substantive NBA text, put it in the composer
          const existing = chatInput.value.trim();
          if (!existing || confirm('Replace current draft with this suggestion?')) {
            chatInput.value = content;
            try { chatInput.dispatchEvent(new Event('input', { bubbles: true })); } catch { }
          }
        }

        // Logic for channel switching if mentioned in content
        const lowerContent = content.toLowerCase();
        const channelSelect = document.getElementById('channel-select');
        if (channelSelect) {
          let targetChannel = null;
          if (lowerContent.includes('whatsapp')) targetChannel = 'whatsapp';
          else if (lowerContent.includes('imessage')) targetChannel = 'imessage';
          else if (lowerContent.includes('email')) targetChannel = 'email';
          else if (lowerContent.includes('linkedin')) targetChannel = 'linkedin';

          if (targetChannel && channelSelect.value !== targetChannel) {
            channelSelect.value = targetChannel;
            try { channelSelect.dispatchEvent(new Event('change', { bubbles: true })); } catch { }
          }
        }
      }

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

function updateChannelOptionsFromKyc(handle, data) {
  const sel = document.getElementById('channel-select');
  if (!sel) return;

  const channels = data?.channels || {};
  const verified = data?.verifiedChannels || {};
  const phone = Array.isArray(channels.phone) ? channels.phone : [];
  const email = Array.isArray(channels.email) ? channels.email : [];

  const available = new Set();
  const verifiedTypes = new Set();

  if (phone.length > 0 || (handle && !String(handle).includes('@'))) {
    available.add('imessage');
    available.add('whatsapp');
    // Check if at least one phone number is verified
    if (phone.some(p => verified[p]) || (handle && verified[handle] && !handle.includes('@'))) {
      verifiedTypes.add('imessage');
      verifiedTypes.add('whatsapp');
    }
  }
  if (email.length > 0 || (handle && String(handle).includes('@'))) {
    available.add('email');
    if (email.some(e => verified[e]) || (handle && verified[handle] && handle.includes('@'))) {
      verifiedTypes.add('email');
    }
  }

  Array.from(sel.options).forEach(o => {
    const isAvailable = available.has(o.value);
    const isVerified = verifiedTypes.has(o.value);

    o.disabled = !isAvailable;
    o.hidden = !isAvailable;

    // Reset text first
    const baseText = o.value.charAt(0).toUpperCase() + o.value.slice(1);
    if (isAvailable && !isVerified) {
      o.textContent = `${baseText} (🔒 Unverified)`;
    } else {
      o.textContent = baseText;
    }
  });

  // If current selection is no longer available, pick a sensible default.
  // We no longer force a fallback just because the preferred channel isn't verified.
  if (!available.has(sel.value)) {
    const preferred = (window.currentChannel || '').toString().toLowerCase();
    const pick = (available.has(preferred))
      ? preferred
      : (available.values().next().value || 'imessage');
    sel.value = pick;
    window.setSelectedChannel?.(pick);
  }
}

export async function loadKYCData(handle) {
  const emptyState = el('kyc-empty-state');
  const editor = el('kyc-content-editor');
  closeProfileActionsMenu();

  if (!handle) {
    setVisible(emptyState, true);
    setVisible(editor, false);
    refreshKycAliasStrip(null).catch(() => {});
    return;
  }

  setVisible(emptyState, false);
  setVisible(editor, true);

  const nameInput = el('kyc-name-input');
  const roleInput = el('kyc-role-input');
  const companyInput = el('kyc-company-input');
  const linkedinInput = el('kyc-linkedin-input');
  const relInput = el('kyc-rel-input');
  const handleInput = el('kyc-handle-input');

  if (handleInput) handleInput.value = handle;
  renderHandlePreview(handle);

  // Loading state
  if (nameInput) nameInput.placeholder = 'Loading...';
  if (roleInput) roleInput.placeholder = 'Loading...';
  if (companyInput) companyInput.placeholder = 'Loading...';
  if (linkedinInput) linkedinInput.placeholder = 'Loading...';
  if (relInput) relInput.placeholder = 'Loading...';

  try {
    const data = await fetchJson(`/api/kyc?handle=${encodeURIComponent(handle)}`, {
      headers: buildSecurityHeaders()
    });
    renderProfileVisibilityState(data);
    if (nameInput) {
      nameInput.value = data.displayName || '';
      nameInput.placeholder = 'Display Name';
    }
    if (roleInput) {
      roleInput.value = data.profession || '';
      roleInput.placeholder = 'Profession / Role';
    }
    if (companyInput) {
      companyInput.value = data.company || '';
      companyInput.placeholder = 'Company';
    }
    if (linkedinInput) {
      linkedinInput.value = data.linkedinUrl || '';
      linkedinInput.placeholder = 'LinkedIn URL';
    }
    if (relInput) {
      relInput.value = data.relationship || '';
      relInput.placeholder = 'Relationship';
    }
    renderNotes(data.notes);
    renderChannels(data.channels);
    renderConnectedServices(data, handle);
    renderSuggestions(handle, data.pendingSuggestions);
    updateChannelOptionsFromKyc(handle, data);
    await refreshKycAliasStrip(data.contactId || handle);
    if (window.currentHandle && String(window.currentHandle) === String(handle)) {
      const activeName = el('active-contact-name-chat');
      if (activeName) {
        activeName.textContent = data.presentationDisplayName || data.displayName || handle;
      }
    }
  } catch (e) {
    console.warn('Failed to load KYC:', e);
    renderProfileVisibilityState({ visibilityState: 'active' });
    if (nameInput) {
      nameInput.value = '';
      nameInput.placeholder = 'Display Name';
    }
    if (roleInput) {
      roleInput.value = '';
      roleInput.placeholder = 'Profession / Role';
    }
    if (companyInput) {
      companyInput.value = '';
      companyInput.placeholder = 'Company';
    }
    if (linkedinInput) {
      linkedinInput.value = '';
      linkedinInput.placeholder = 'LinkedIn URL';
    }
    if (relInput) {
      relInput.value = '';
      relInput.placeholder = 'Relationship';
    }
    renderHandlePreview(handle);
    renderNotes([]);
    renderChannels(null);
    renderConnectedServices(null, handle);
    renderSuggestions(handle, []);
    updateChannelOptionsFromKyc(handle, null);
    await refreshKycAliasStrip(handle);
  }
}

async function applyVisibilityState(state) {
  const handle = el('kyc-handle-input')?.value?.trim();
  if (!handle) return;

  const action = String(state || '').toLowerCase();
  const confirmText = {
    archived: 'Archive this contact until a new inbound message arrives?',
    removed: 'Remove this contact and conversation from {reply} while keeping it available for annotation?',
    blocked: 'Block this contact in {reply} and exclude it from annotation and analysis?',
  }[action] || 'Apply this contact action?';
  if (!window.confirm(confirmText)) return;

  const { updateContactVisibility } = await import('./api.js');
  await updateContactVisibility(handle, action);
  closeProfileActionsMenu();

  const emptyState = el('kyc-empty-state');
  const editor = el('kyc-content-editor');
  if (emptyState) emptyState.style.display = 'block';
  if (editor) editor.style.display = 'none';
  if (typeof window.selectContact === 'function') {
    await window.selectContact(null);
  }
  if (typeof window.loadConversations === 'function') {
    await window.loadConversations(false);
  }
  UI.showToast(`${visibilityLabel(action)} contact updated.`, 'success', 2400);
}

export async function saveInlineProfile(btn = null) {
  if (btn) {
    setIconButtonBusyState(btn, {
      busy: true,
      busyIcon: 'info',
      idleIcon: 'save',
      busyLabel: 'Saving',
      idleLabel: 'Save',
      busyTooltip: 'Saving profile changes',
      idleTooltip: 'Save profile changes',
    });
  }

  try {
    const handle = el('kyc-handle-input')?.value?.trim();
    if (!handle) return;

    const payload = {
      handle,
      displayName: el('kyc-name-input')?.value?.trim() || '',
      profession: el('kyc-role-input')?.value?.trim() || '',
      company: el('kyc-company-input')?.value?.trim() || '',
      linkedinUrl: el('kyc-linkedin-input')?.value?.trim() || '',
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
      setIconButtonBusyState(btn, {
        busy: false,
        busyIcon: 'info',
        idleIcon: 'save',
        busyLabel: 'Saving',
        idleLabel: 'Save',
        busyTooltip: 'Saving profile changes',
        idleTooltip: 'Save profile changes',
      });
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
      company: el('prof-company')?.value?.trim() || '',
      linkedinUrl: el('prof-linkedin')?.value?.trim() || '',
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
    UI.showToast(e.message || 'Save failed', 'error');
  }
};

window.saveProfile = async (btn) => {
  try {
    console.log('[KYC] saveProfile() triggered', { btn: !!btn });
    await saveProfile(btn);
    console.log('[KYC] saveProfile() success');
  } catch (e) {
    console.error('[KYC] saveProfile() ERROR:', e);
    UI.showToast(e.message || 'Save failed', 'error');
  }
};

window.closeProfileModal = closeProfileModal;
window.addNote = () => addNote().catch((e) => console.error('Add note failed:', e));
window.deleteNote = (id) => deleteNote(id).catch((e) => console.error('Delete note failed:', e));
window.loadKYCData = loadKYCData;
window.dismissKYC = dismissKYC;
window.acceptKYC = dismissKYC;
window.editKYC = dismissKYC;

window.openMergeModal = () => {
  closeProfileActionsMenu();
  const handle = el('kyc-handle-input')?.value?.trim();
  if (!handle) return alert('No contact selected');
  const sourceHandleEl = el('merge-source-handle');
  if (sourceHandleEl) sourceHandleEl.textContent = handle;
  const targetHandleEl = el('merge-target-handle');
  if (targetHandleEl) targetHandleEl.value = '';
  const modal = el('merge-modal');
  if (modal) modal.style.display = 'flex';
};

window.closeMergeModal = () => {
  const modal = el('merge-modal');
  if (modal) modal.style.display = 'none';
};

window.openHiddenContactsPage = () => {
  window.location.href = 'hidden-contacts.html';
};

window.archiveCurrentProfile = () => {
  applyVisibilityState('archived').catch((e) => {
    console.error('Archive failed:', e);
    UI.showToast(e.message || 'Archive failed', 'error');
  });
};

window.removeCurrentProfile = () => {
  applyVisibilityState('removed').catch((e) => {
    console.error('Remove failed:', e);
    UI.showToast(e.message || 'Remove failed', 'error');
  });
};

window.blockCurrentProfile = () => {
  applyVisibilityState('blocked').catch((e) => {
    console.error('Block failed:', e);
    UI.showToast(e.message || 'Block failed', 'error');
  });
};

window.executeMerge = async (btn) => {
  const sourceHandle = el('merge-source-handle')?.textContent?.trim();
  const targetHandle = el('merge-target-handle')?.value?.trim();

  if (!sourceHandle || !targetHandle) return alert('Target handle is required');
  if (sourceHandle === targetHandle) return alert('Cannot merge a contact into itself');

  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Merging...';

  try {
    const { mergeContacts } = await import('./api.js');
    await mergeContacts(targetHandle, sourceHandle);

    window.closeMergeModal();

    // Close the current profile pane to avoid stale state and force UI refresh
    const emptyState = el('kyc-empty-state');
    const editor = el('kyc-content-editor');
    if (emptyState) emptyState.style.display = 'block';
    if (editor) editor.style.display = 'none';

    // Refresh sidebar conversations
    if (typeof window.loadConversations === 'function') {
      try {
        await window.loadConversations(false);
      } catch (e) {
        console.warn('Failed to refresh conversations after merge:', e);
      }
    }
  } catch (e) {
    console.error('Merge failed:', e);
    UI.showToast(e.message || 'Merge failed', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
};

// Wire Analyze button (exists only when profile editor is visible)
function wireAnalyzeButton() {
  const btn = document.getElementById('btn-deep-analyze');
  if (!btn) return;
  btn.onclick = async () => {
    const handle = document.getElementById('kyc-handle-input')?.value?.trim();
    if (!handle) return;
    try {
      setIconButtonBusyState(btn, {
        busy: true,
        busyIcon: 'info',
        idleIcon: 'analytics',
        busyLabel: 'Analyzing',
        idleLabel: 'Analyze',
        busyTooltip: 'Analyzing profile',
        idleTooltip: 'Run profile analysis',
      });
      UI.showLoading();
      await analyzeContact(handle);
      UI.showToast('KYC analysis complete', 'success', 2500);
    } catch (e) {
      console.error('Analyze failed:', e);
      UI.showToast(e.message || 'Analyze failed', 'error');
    } finally {
      UI.hideLoading();
      setIconButtonBusyState(btn, {
        busy: false,
        busyIcon: 'info',
        idleIcon: 'analytics',
        busyLabel: 'Analyzing',
        idleLabel: 'Analyze',
        busyTooltip: 'Analyzing profile',
        idleTooltip: 'Run profile analysis',
      });
    }
  };
}

function wireProfileActions() {
  const toggleBtn = el('btn-profile-actions');
  if (toggleBtn && toggleBtn.dataset.wired !== '1') {
    toggleBtn.dataset.wired = '1';
    toggleBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleProfileActionsMenu();
    });
  }
  if (document.body && document.body.dataset.profileActionsWired !== '1') {
    document.body.dataset.profileActionsWired = '1';
    document.addEventListener('click', (event) => {
      const menu = el('profile-actions-menu');
      const toggle = el('btn-profile-actions');
      if (!menu || menu.classList.contains('u-display-none')) return;
      if (menu.contains(event.target) || toggle?.contains(event.target)) return;
      closeProfileActionsMenu();
    });
  }
}

function wireLocalIntelligenceInput() {
  const input = document.getElementById('new-note-input');
  if (!input) return;
  if (input.dataset.wired === '1') return;
  input.dataset.wired = '1';
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if (e.shiftKey) return;
    e.preventDefault();
    window.addNote?.();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    wireAnalyzeButton();
    wireProfileActions();
    wireLocalIntelligenceInput();
  });
} else {
  wireAnalyzeButton();
  wireProfileActions();
  wireLocalIntelligenceInput();
}
