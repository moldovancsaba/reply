/**
 * {reply} - Contacts Module
 * Manages contact list loading, display, and pagination
 */

import { fetchConversations } from './api.js';
import { UI } from './ui.js';
import { createPlatformIcon, resolvePlatformTarget } from './platform-icons.js';
import { APP_DISPLAY_NAME } from './branding.js';

/** Strip `{name}` wrapper used in some contact labels so the list doesn’t look like a template bug. */
export function formatContactLabel(raw) {
    const s = String(raw || '').trim();
    if (!s) return s;
    const m = s.match(/^\{([^}]{1,128})\}$/);
    return m ? m[1].trim() : s;
}

// State
let contactOffset = 0;
let hasMoreContacts = true;
const CONTACT_LIMIT = 20;
export let conversations = []; // Global cache for contacts
let conversationsQuery = '';
/** @type {'newest'|'oldest'|'freq'|'volume_in'|'volume_out'|'volume_total'|'recommendation'} */
let conversationsSort = 'newest';
let contactObserver = null;
let isLoadingContacts = false;
const CONVERSATIONS_CACHE_VERSION = 'v4';

function setPanelVisible(element, visible, displayValue = '') {
    if (!element) return;
    element.classList.toggle('u-display-none', !visible);
    element.style.display = visible ? displayValue : 'none';
}

function conversationsCacheKey(query = conversationsQuery, sort = conversationsSort) {
    return `reply.conversations.${CONVERSATIONS_CACHE_VERSION}.${String(query || '').trim().toLowerCase()}::${normalizeConversationSort(sort)}`;
}

function readCachedConversationPage(query = conversationsQuery, sort = conversationsSort) {
    try {
        const raw = window.localStorage?.getItem(conversationsCacheKey(query, sort));
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.contacts)) return null;
        return parsed;
    } catch {
        return null;
    }
}

function writeCachedConversationPage(payload, query = conversationsQuery, sort = conversationsSort) {
    try {
        if (!window.localStorage || !payload || !Array.isArray(payload.contacts)) return;
        const serializable = {
            contacts: payload.contacts,
            hasMore: !!payload.hasMore,
            total: Number(payload.total) || payload.contacts.length,
            cachedAt: new Date().toISOString(),
        };
        window.localStorage.setItem(conversationsCacheKey(query, sort), JSON.stringify(serializable));
    } catch {
        // Non-blocking cache only.
    }
}

function renderConversationsPage(contacts, append = false) {
    const contactListEl = document.getElementById('contact-list');
    if (!contactListEl) return;

    if (!append) {
        contactListEl.innerHTML = '';
    }

    contacts.forEach(contact => {
        const item = document.createElement('div');
        item.className = 'sidebar-item';
        item.dataset.handle = contact.handle;
        if (window.currentHandle && (String(window.currentHandle) === String(contact.handle) || String(window.currentHandle) === String(contact.latestHandle || ''))) {
            item.classList.add('active');
        }

        const statusDot = document.createElement('div');
        statusDot.className = 'status-dot';
        if (contact.status && contact.status !== 'open') {
            statusDot.classList.add(contact.status);
        } else {
            statusDot.style.display = 'none';
        }

        const info = document.createElement('div');
        info.className = 'contact-info';

        const topRow = document.createElement('div');
        topRow.className = 'contact-top-row';

        const name = document.createElement('div');
        name.className = 'contact-name';
        const channel = contact.lastChannel || contact.channel || contact.lastSource || contact.source || '';
        const handleForHint = contact.latestHandle || contact.handle || '';
        const rawLabel = formatContactLabel(
            contact.presentationDisplayName || contact.displayName || contact.name || contact.handle
        );
        name.textContent = rawLabel;

        topRow.appendChild(name);

        const count = Number.isFinite(Number(contact.count)) ? parseInt(contact.count, 10) : 0;
        const badge = document.createElement('div');
        badge.className = 'message-badge';
        badge.textContent = count > 99 ? '99+' : count;
        if (count === 0) {
            badge.classList.add('badge-zero');
            badge.title = 'No messages yet';
        } else {
            badge.title = `${count} messages`;
        }
        topRow.appendChild(badge);

        const bridgeBadgeLabel = formatBridgePolicyBadge(contact.bridgePolicy);
        if (bridgeBadgeLabel) {
            const bridgeBadge = document.createElement('div');
            bridgeBadge.className = 'bridge-policy-badge';
            bridgeBadge.textContent = bridgeBadgeLabel;
            bridgeBadge.title = `Bridge inbound mode: ${bridgeBadgeLabel}`;
            topRow.appendChild(bridgeBadge);
        }
        info.appendChild(topRow);

        const preview = document.createElement('div');
        preview.className = 'contact-preview';
        if (contact.lastMessage && contact.lastMessage !== 'Click to see history') {
            preview.textContent = contact.lastMessage;
            preview.classList.remove('contact-preview--empty');
        } else {
            preview.textContent = 'No recent messages';
            preview.classList.add('contact-preview--empty');
        }

        info.appendChild(preview);

        item.appendChild(statusDot);
        item.appendChild(info);

        const iconHint = [handleForHint, contact.lastMessage].filter(Boolean).join(' ');
        const waLidHint = /^[a-zA-Z0-9+/]+={0,2}$/.test(String(handleForHint)) && String(handleForHint).length >= 20;
        const syntheticChannel =
            channel ||
            (waLidHint ? 'whatsapp' : '') ||
            (String(handleForHint).includes('@') ? 'email' : '');
        const iconSeed = syntheticChannel ? '' : iconHint;
        const iconPlatform = resolvePlatformTarget(iconSeed, { channelHint: syntheticChannel || channel }).platform;
        const icon = createPlatformIcon(iconPlatform, channel || 'channel');
        icon.classList.add('channel-icon');
        const channelLabel = (contact.lastChannel || contact.channel || '').toString();
        const sourceLabel = (contact.lastSource || contact.source || '').toString();
        icon.title = [
            channelLabel ? `Latest channel: ${channelLabel}` : null,
            sourceLabel ? `Source: ${sourceLabel}` : null,
            bridgeBadgeLabel ? `Bridge: ${bridgeBadgeLabel}` : null,
        ].filter(Boolean).join('\n') || 'Latest channel';
        item.appendChild(icon);

        item.onclick = () => window.selectContact(contact.handle);

        contactListEl.appendChild(item);
    });

    if (hasMoreContacts) {
        const sentinel = document.createElement('div');
        sentinel.className = 'contact-list-sentinel';
        sentinel.style.cssText = 'padding: 1rem; text-align: center; color: #888; font-size: 0.9rem;';
        sentinel.innerHTML = '<span>Loading more...</span>';
        contactListEl.appendChild(sentinel);

        if (!contactObserver) {
            contactObserver = new IntersectionObserver((entries) => {
                const first = entries[0];
                if (first.isIntersecting && hasMoreContacts && !isLoadingContacts) {
                    contactOffset += CONTACT_LIMIT;
                    loadConversations(true);
                }
            }, { root: contactListEl, rootMargin: '100px' });
        }

        contactObserver.disconnect();
        contactObserver.observe(sentinel);
    } else if (contactObserver) {
        contactObserver.disconnect();
    }
}

async function refreshConversationsFromServer(append = false) {
    const contactListEl = document.getElementById('contact-list');
    if (!contactListEl) return;

    const data = await fetchConversations(
        contactOffset,
        CONTACT_LIMIT,
        conversationsQuery,
        conversationsSort,
        false
    );
    if (data?.meta && data.meta.sortValid === false) {
        const req = data.meta.sortRequested != null ? String(data.meta.sortRequested) : '';
        UI.showToast(
            req
                ? `Unknown conversation sort “${req}”. Using newest.`
                : 'Unknown conversation sort. Using newest.',
            'warning',
            5000
        );
    }

    hasMoreContacts = data.hasMore;

    if (append) {
        conversations = [...conversations, ...data.contacts];
    } else {
        conversations = data.contacts;
    }
    window.conversations = conversations;

    renderConversationsPage(data.contacts, append);
    try {
        if (typeof window.reconcileContactDraft === 'function' && window.currentHandle) {
            const activeContact =
                conversations.find((c) => String(c.handle) === String(window.currentHandle)) ||
                conversations.find((c) => String(c.latestHandle || '') === String(window.currentHandle)) ||
                null;
            if (activeContact && activeContact.draft) {
                window.reconcileContactDraft(window.currentHandle, activeContact.draft, {
                    explanation: 'Suggestion ready for this conversation.'
                });
            }
        }
    } catch (e) {
        console.warn('[contacts] Failed to reconcile active contact draft:', e);
    }

    if (!append && !conversationsQuery) {
        writeCachedConversationPage({
            contacts: data.contacts,
            hasMore: data.hasMore,
            total: data.total,
        });
    }
}

function formatBridgePolicyBadge(policy) {
    if (!policy || !policy.managed) return '';
    const key = String(policy.channel || '').toLowerCase();
    const isLinkedIn = key === 'linkedin';
    const channelLabel = key === 'telegram' ? 'Telegram' : (key === 'discord' ? 'Discord' : (isLinkedIn ? 'LinkedIn' : (key || 'Bridge')));
    const rawMode = String(policy.inboundMode || '').trim().toLowerCase() || 'unknown';
    const mode = (isLinkedIn && rawMode === 'draft_only') ? 'active' : rawMode;
    return `${channelLabel} ${mode}`;
}

/**
 * Load conversations/contacts with pagination
 * @param {boolean} append - Whether to append to existing list or replace
 */
const SORT_OPTIONS = new Set([
    'newest',
    'oldest',
    'freq',
    'volume_in',
    'volume_out',
    'volume_total',
    'recommendation'
]);

/** LocalStorage key shared by dashboard and settings sidebars. */
export const CONVERSATION_SORT_STORAGE_KEY = 'replyConversationsSort';

export function normalizeConversationSort(mode) {
    const m = String(mode || 'newest').toLowerCase().trim();
    return SORT_OPTIONS.has(m) ? m : 'newest';
}

export function isValidConversationSortMode(mode) {
    const m = String(mode || '').toLowerCase().trim();
    return SORT_OPTIONS.has(m);
}

/** Update in-memory sort only (e.g. before the first `loadConversations`). */
export function applyConversationSortOnly(mode) {
    conversationsSort = normalizeConversationSort(mode);
}

/**
 * Change list ordering (see /api/conversations?sort=…)
 */
export function setConversationsSort(mode) {
    conversationsSort = normalizeConversationSort(mode);
    return loadConversations(false);
}

export async function loadConversations(append = false) {
    const contactListEl = document.getElementById('contact-list');
    if (!contactListEl) return;

    try {
        if (isLoadingContacts) return;
        isLoadingContacts = true;

        const canUseStartupCache = !append && !conversationsQuery;
        const cached = canUseStartupCache ? readCachedConversationPage() : null;

        if (!append) {
            contactOffset = 0;
            if (cached && !conversations.length) {
                hasMoreContacts = !!cached.hasMore;
                conversations = cached.contacts;
                window.conversations = conversations;
                renderConversationsPage(cached.contacts, false);
                refreshConversationsFromServer(false)
                    .catch((error) => {
                        console.error('Background contact refresh failed:', error);
                    });
                return;
            }

            if (!conversations.length) {
                contactListEl.innerHTML = '<div style="padding:20px; text-align:center; color:#888;">Loading contacts...</div>';
            }
        }

        await refreshConversationsFromServer(append);

    } catch (error) {
        console.error('Failed to load conversations:', error);
        UI.showToast(error?.message || 'Failed to load contacts', 'error');
        if (!conversations.length) contactListEl.innerHTML = `
      <div style="padding:20px; text-align:center; color:#d32f2f;">
        <p>Failed to load contacts</p>
        <button onclick="window.loadConversations()" style="margin-top:1rem; padding:0.5rem 1rem; cursor:pointer;">
          Retry
        </button>
      </div>
    `;
    } finally {
        isLoadingContacts = false;
    }
}

export async function setConversationsQuery(query) {
    conversationsQuery = (query || '').toString();
    contactOffset = 0;
    hasMoreContacts = true;
    return await loadConversations(false);
}

/**
 * Select a contact to view their chat or show dashboard if null
 * @param {string|null} handle - Contact handle or null for dashboard
 */
export async function selectContact(handle) {
    const messagesEl = document.getElementById('messages');
    const dashboardEl = document.getElementById('dashboard');
    const settingsPageEl = document.getElementById('settings-page');
    const activeNameEl = document.getElementById('active-contact-name-chat');
    const inputArea = document.querySelector('.input-area');
    const chatInput = document.getElementById('chat-input');
    const body = document.body;
    const chatHeader = document.querySelector('.chat-header');
    if (!messagesEl || !dashboardEl || !activeNameEl || !inputArea) {
        console.warn('selectContact(): missing required DOM nodes', {
            messagesEl: !!messagesEl,
            dashboardEl: !!dashboardEl,
            activeNameEl: !!activeNameEl,
            inputArea: !!inputArea,
        });
        return;
    }

    if (settingsPageEl) settingsPageEl.style.display = 'none';
    if (body) body.classList.remove('mode-settings');
    if (chatHeader) chatHeader.style.display = 'flex';

    // Update active state in sidebar
    document.querySelectorAll('.sidebar-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.handle === handle) {
            item.classList.add('active');
        }
    });

    const previousHandle = window.currentHandle;
    if (previousHandle && typeof window.cacheComposerDraft === 'function' && chatInput) {
        window.cacheComposerDraft(previousHandle, chatInput.value);
    }

    if (handle === null) {
        if (body) body.classList.add('mode-dashboard');
        if (typeof window.refreshSuggestButtonState === 'function') {
            window.refreshSuggestButtonState();
        }

        // Show dashboard
        activeNameEl.textContent = APP_DISPLAY_NAME;
        setPanelVisible(dashboardEl, true, '');
        setPanelVisible(messagesEl, false);
        setPanelVisible(inputArea, false);
        const statusSelect = document.getElementById('status-select');
        if (statusSelect) statusSelect.style.display = 'none';
        const suggestBtn = document.getElementById('btn-suggest');
        if (suggestBtn) suggestBtn.style.display = 'none';
        const micBtn = document.getElementById('btn-mic');
        if (micBtn) micBtn.style.display = 'none';
        const magicBtn = document.getElementById('btn-magic');
        if (magicBtn) magicBtn.style.display = 'none';
        // KYC pane is hidden in dashboard mode via CSS.

        // Render dashboard
        if (typeof window.renderDashboard === 'function') {
            await window.renderDashboard();
        } else {
            console.warn('Dashboard module not loaded: window.renderDashboard is missing');
            dashboardEl.innerHTML = `
        <div style="padding:40px; text-align:center; color:#d32f2f;">
          <h3>Dashboard unavailable</h3>
          <p>Client failed to load the dashboard module.</p>
        </div>
      `;
        }
        return;
    }

    if (body) body.classList.remove('mode-dashboard');

    // Show chat view
    window.currentHandle = handle;
    setPanelVisible(dashboardEl, false);
    setPanelVisible(messagesEl, true, 'flex');
    setPanelVisible(inputArea, true, 'flex');
    const statusSelect = document.getElementById('status-select');
    if (statusSelect) statusSelect.style.display = 'inline-block';
    const suggestBtn = document.getElementById('btn-suggest');
    if (suggestBtn) suggestBtn.style.display = 'inline-block';
    const micBtn = document.getElementById('btn-mic');
    if (micBtn) micBtn.style.display = 'inline-block';
    const magicBtn = document.getElementById('btn-magic');
    if (magicBtn) magicBtn.style.display = 'inline-block';

    // Find contact info
    const contact =
        conversations.find(c => String(c.handle) === String(handle)) ||
        conversations.find(c => String(c.latestHandle || '') === String(handle)) ||
        null;
    if (!contact) {
        window.currentHandle = null;
        if (typeof window.refreshSuggestButtonState === 'function') {
            window.refreshSuggestButtonState();
        }
        UI.showToast('This conversation is no longer available in {reply}.', 'warning', 3200);
        await selectContact(null);
        return;
    }
    if (contact) {
        activeNameEl.textContent = formatContactLabel(contact.presentationDisplayName || contact.displayName || contact.name || contact.handle);
        if (typeof window.setSelectedChannel === 'function') {
            window.setSelectedChannel(contact.channel || (handle.includes('@') ? 'email' : 'imessage'));
        }
    }

    if (chatInput) {
        const cachedDraft = typeof window.getCachedComposerDraft === 'function'
            ? window.getCachedComposerDraft(handle)
            : '';
        chatInput.value = cachedDraft || '';
        try { chatInput.dispatchEvent(new Event('input', { bubbles: true })); } catch { }
    }

    const messageTask = window.loadMessages(handle);

    // Seed persisted local draft into the composer if one exists for this contact.
    try {
        if (contact && contact.draft && chatInput && !String(chatInput.value || '').trim() && typeof window.seedDraft === 'function') {
            window.seedDraft(contact.draft);
        }
    } catch (e) {
        console.warn('[selectContact] Failed to seed draft:', e);
    }

    try {
        if (typeof window.applyCachedSuggestionForHandle === 'function') {
            window.applyCachedSuggestionForHandle(handle, { force: false });
        }
        if (typeof window.refreshSuggestButtonState === 'function') {
            window.refreshSuggestButtonState();
        }
        if (typeof window.pollActiveConversationDraft === 'function') {
            void window.pollActiveConversationDraft();
        }
    } catch (e) {
        console.warn('[selectContact] Failed to apply cached suggestion:', e);
    }

    // Load KYC
    try {
        if (typeof window.loadKYCData === 'function') {
            await window.loadKYCData(handle);
        }
    } catch (e) {
        console.warn('Failed to load KYC data:', e);
    }

    await messageTask;
}

// Export to window for onclick handlers
window.loadConversations = loadConversations;
window.selectContact = selectContact;
