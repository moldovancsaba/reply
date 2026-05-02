import { fetchHiddenContacts, restoreContact } from './api.js';
import { applyIconFallback } from './icon-fallback.js';
import { UI } from './ui.js';

function formatWhen(value) {
  if (!value) return 'Unknown activity';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown activity';
  return date.toLocaleString();
}

function visibilityLabel(state) {
  const key = String(state || 'active').toLowerCase();
  if (key === 'archived') return 'Archived';
  if (key === 'removed') return 'Removed';
  if (key === 'blocked') return 'Blocked';
  return 'Active';
}

function renderHiddenContacts(contacts) {
  const list = document.getElementById('hidden-contacts-list');
  const count = document.getElementById('hidden-contacts-count');
  if (!list || !count) return;

  count.textContent = contacts.length === 1 ? '1 hidden contact' : `${contacts.length} hidden contacts`;
  list.innerHTML = '';

  if (!contacts.length) {
    list.innerHTML = '<div class="hidden-contacts-empty">No archived, removed, or blocked contacts.</div>';
    return;
  }

  for (const contact of contacts) {
    const card = document.createElement('article');
    card.className = 'hidden-contact-card';

    const main = document.createElement('div');
    main.className = 'hidden-contact-main';

    const title = document.createElement('h2');
    title.className = 'hidden-contact-title';
    title.textContent = contact.presentationDisplayName || contact.displayName || contact.handle || 'Unknown contact';
    main.appendChild(title);

    const handle = document.createElement('p');
    handle.className = 'hidden-contact-handle';
    handle.textContent = contact.handle || '';
    main.appendChild(handle);

    const meta = document.createElement('div');
    meta.className = 'hidden-contact-meta';

    const stateChip = document.createElement('span');
    stateChip.className = `kyc-visibility-badge is-${String(contact.visibilityState || 'active').toLowerCase()}`;
    stateChip.textContent = visibilityLabel(contact.visibilityState);
    meta.appendChild(stateChip);

    const channelChip = document.createElement('span');
    channelChip.className = 'hidden-contact-meta-chip';
    channelChip.textContent = contact.lastChannel ? `Last channel: ${contact.lastChannel}` : 'No channel recorded';
    meta.appendChild(channelChip);

    const whenChip = document.createElement('span');
    whenChip.className = 'hidden-contact-meta-chip';
    whenChip.textContent = `Last active: ${formatWhen(contact.lastContacted)}`;
    meta.appendChild(whenChip);

    const annotationChip = document.createElement('span');
    annotationChip.className = 'hidden-contact-meta-chip';
    annotationChip.textContent = contact.annotationEnabled ? 'Annotation enabled' : 'Annotation blocked';
    meta.appendChild(annotationChip);

    main.appendChild(meta);
    card.appendChild(main);

    const actions = document.createElement('div');
    actions.className = 'hidden-contact-actions';

    const restoreBtn = document.createElement('button');
    restoreBtn.type = 'button';
    restoreBtn.className = 'btn btn-primary btn-sm';
    restoreBtn.textContent = 'Bring Back';
    restoreBtn.onclick = async () => {
      restoreBtn.disabled = true;
      try {
        await restoreContact(contact.handle);
        UI.showToast('Contact restored.', 'success', 2200);
        await loadHiddenContacts();
      } catch (error) {
        UI.showToast(error.message || 'Restore failed', 'error');
      } finally {
        restoreBtn.disabled = false;
      }
    };
    actions.appendChild(restoreBtn);
    card.appendChild(actions);

    list.appendChild(card);
  }
}

async function loadHiddenContacts() {
  const payload = await fetchHiddenContacts();
  renderHiddenContacts(Array.isArray(payload.contacts) ? payload.contacts : []);
}

function init() {
  applyIconFallback(document);
  UI.initThemeControls();
  document.getElementById('btn-hidden-back')?.addEventListener('click', () => {
    window.location.href = 'index.html';
  });
  document.getElementById('btn-hidden-refresh')?.addEventListener('click', () => {
    loadHiddenContacts().catch((error) => {
      UI.showToast(error.message || 'Refresh failed', 'error');
    });
  });
  loadHiddenContacts().catch((error) => {
    UI.showToast(error.message || 'Failed to load hidden contacts', 'error');
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
