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

        // Show loading state
        if (!append) {
            contactOffset = 0;
            contactListEl.innerHTML = '<div style="padding:20px; text-align:center; color:#888;">Loading contacts...</div>';
        }

        // Fetch contacts from server
        const data = await fetchConversations(
            contactOffset,
            CONTACT_LIMIT,
            conversationsQuery,
            conversationsSort,
            !append
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

        // Update state
        hasMoreContacts = data.hasMore;

        if (append) {
            conversations = [...conversations, ...data.contacts];
        } else {
            conversations = data.contacts;
            contactListEl.innerHTML = '';
        }
        // Keep a single global pointer for modules that update contact labels (e.g. KYC save).
        window.conversations = conversations;

        // Render contacts
        data.contacts.forEach(contact => {
            const item = document.createElement('div');
            item.className = 'sidebar-item';
            item.dataset.handle = contact.handle;
            if (window.currentHandle && (String(window.currentHandle) === String(contact.handle) || String(window.currentHandle) === String(contact.latestHandle || ''))) {
                item.classList.add('active');
            }

            // Status indicator (only if not 'open' which is default)
            const statusDot = document.createElement('div');
            statusDot.className = 'status-dot';
            if (contact.status && contact.status !== 'open') {
                statusDot.classList.add(contact.status);
            } else {
                statusDot.style.display = 'none'; // Clean look for normal contacts
            }

            // Contact info
            const info = document.createElement('div');
            info.className = 'contact-info';

            const topRow = document.createElement('div');
            topRow.className = 'contact-top-row';

            const name = document.createElement('div');
            name.className = 'contact-name';
            const channel = contact.lastChannel || contact.channel || contact.lastSource || contact.source || '';
            const displayName = formatContactLabel(contact.displayName || contact.name || contact.handle);
            name.textContent = displayName;

            // Optional: Time would go here if available
            // const time = document.createElement('div');
            // time.className = 'contact-time'; 

            topRow.appendChild(name);

            // Message count badge - Moved next to name for zero-gap
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
            // Only show preview if it exists and isn't the default placeholder
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

            // Channel indicator (latest channel/source)
            const iconHint = [contact.latestHandle, contact.handle, contact.lastMessage]
                .filter(Boolean)
                .join(' ');
            const iconSeed = channel || iconHint;
            const iconPlatform = resolvePlatformTarget(iconSeed, { channelHint: channel }).platform;
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

            // Click handler
            item.onclick = () => window.selectContact(contact.handle);

            contactListEl.appendChild(item);
        });

        // Add sentinel element for infinite scrolling if there are more contacts
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

    } catch (error) {
        console.error('Failed to load conversations:', error);
        UI.showToast(error?.message || 'Failed to load contacts', 'error');
        contactListEl.innerHTML = `
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

    if (handle === null) {
        if (body) body.classList.add('mode-dashboard');

        // Show dashboard
        activeNameEl.textContent = APP_DISPLAY_NAME;
        dashboardEl.style.display = 'grid';
        messagesEl.style.display = 'none';
        inputArea.style.display = 'none';
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
    dashboardEl.style.display = 'none';
    messagesEl.style.display = 'flex';
    inputArea.style.display = 'flex';
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
    if (contact) {
        activeNameEl.textContent = formatContactLabel(contact.displayName || contact.name || contact.handle);
        if (typeof window.setSelectedChannel === 'function') {
            window.setSelectedChannel(contact.channel || (handle.includes('@') ? 'email' : 'imessage'));
        }
    }

    // Load messages
    await window.loadMessages(handle);

    // Seed {hatori} draft into composer if one exists for this contact
    try {
        if (contact && contact.draft && typeof window.seedHatoriDraft === 'function') {
            window.seedHatoriDraft(contact.draft, contact.draft_hatori_id || null);
        }
    } catch (e) {
        console.warn('[selectContact] Failed to seed hatori draft:', e);
    }

    // Load KYC
    try {
        if (typeof window.loadKYCData === 'function') {
            await window.loadKYCData(handle);
        }
    } catch (e) {
        console.warn('Failed to load KYC data:', e);
    }
}

// Export to window for onclick handlers
window.loadConversations = loadConversations;
window.selectContact = selectContact;
