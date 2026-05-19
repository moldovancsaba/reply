/**
 * {reply} - Contacts Module
 * Manages contact list loading, display, and pagination
 */

import { fetchConversations, saveKYC } from './api.js';
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
let conversationsQueue = 'all';
let conversationsChannel = 'all';
let conversationsOwnerScope = 'all';
let conversationsOwnerIdentity = '';
let contactObserver = null;
let isLoadingContacts = false;
const CONVERSATIONS_CACHE_VERSION = 'v6';
const WORKSPACE_OWNER_STORAGE_KEY = 'reply.workspaceOwnerIdentity';
let workspaceMetaCache = null;
let workspaceOwnerReloadTimer = null;
let selectedConversationHandles = new Set();
let bulkAssignmentInFlight = false;

function setPanelVisible(element, visible, displayValue = '') {
    if (!element) return;
    element.classList.toggle('u-display-none', !visible);
    element.style.display = visible ? displayValue : 'none';
}

function sameOwnerIdentity(left, right) {
    return String(left || '').trim().toLowerCase() === String(right || '').trim().toLowerCase();
}

function normalizeFlagList(values = []) {
    return Array.from(new Set(
        (Array.isArray(values) ? values : [])
            .map((value) => String(value || '').trim().toLowerCase())
            .filter(Boolean)
    ));
}

function formatAgeHoursLabel(hours) {
    const value = Number(hours) || 0;
    if (value >= 24) {
        const days = Math.round((value / 24) * 10) / 10;
        return `${days}d stale`;
    }
    const rounded = Math.round(value * 10) / 10;
    return `${rounded}h stale`;
}

function computeOldestActionableRankMap(contacts = []) {
    const ranked = (Array.isArray(contacts) ? contacts : [])
        .filter((contact) => {
            const queueKey = String(contact?.workspace?.queueKey || '').trim();
            const ageMs = Number(contact?.workspaceAge?.ageMs || 0);
            return (queueKey === 'needs_reply' || queueKey === 'draft_ready' || queueKey === 'escalated') && ageMs > 0;
        })
        .sort((left, right) => {
            const ageDiff = Number(right?.workspaceAge?.ageMs || 0) - Number(left?.workspaceAge?.ageMs || 0);
            if (ageDiff !== 0) return ageDiff;
            return String(left?.displayName || left?.handle || '').localeCompare(String(right?.displayName || right?.handle || ''));
        })
        .slice(0, 3);

    const rankMap = new Map();
    ranked.forEach((contact, index) => {
        const handle = String(contact?.handle || '').trim();
        if (handle) rankMap.set(handle, index + 1);
    });
    return rankMap;
}

function getSelectedConversationHandles() {
    return Array.from(selectedConversationHandles);
}

function pruneSelectedConversationHandles() {
    const visibleHandles = new Set((Array.isArray(conversations) ? conversations : []).map((entry) => String(entry?.handle || '').trim()).filter(Boolean));
    selectedConversationHandles = new Set(
        Array.from(selectedConversationHandles).filter((handle) => visibleHandles.has(String(handle || '').trim()))
    );
}

function toggleConversationSelection(handle, checked) {
    const normalizedHandle = String(handle || '').trim();
    if (!normalizedHandle) return;
    if (checked) selectedConversationHandles.add(normalizedHandle);
    else selectedConversationHandles.delete(normalizedHandle);
    renderWorkspaceBulkActions();
}

async function applyBulkConversationOwner(nextOwner, { successMessage } = {}) {
    const handles = getSelectedConversationHandles();
    if (!handles.length || bulkAssignmentInFlight) return;
    bulkAssignmentInFlight = true;
    renderWorkspaceBulkActions();
    try {
        for (const handle of handles) {
            await saveKYC(handle, { owner: String(nextOwner || '').trim() }, { toastMessage: null });
            const contact = Array.isArray(window.conversations)
                ? window.conversations.find((entry) => entry && String(entry.handle) === String(handle))
                : null;
            if (contact) contact.owner = String(nextOwner || '').trim();
        }
        selectedConversationHandles.clear();
        if (typeof window.loadConversations === 'function') {
            await window.loadConversations(false);
        }
        if (window.currentHandle && handles.includes(String(window.currentHandle))) {
            if (typeof window.loadKYCData === 'function') {
                await window.loadKYCData(window.currentHandle);
            }
        }
        UI.showToast(successMessage || 'Bulk assignment updated.', 'success', 2400);
    } catch (error) {
        console.error('Bulk conversation owner update failed:', error);
        UI.showToast(error?.message || 'Failed to update selected owners', 'error');
    } finally {
        bulkAssignmentInFlight = false;
        renderWorkspaceBulkActions();
    }
}

function renderWorkspaceBulkActions() {
    const root = document.getElementById('workspace-bulk-actions');
    if (!root) return;

    const selectedCount = selectedConversationHandles.size;
    const ownerIdentity = String(conversationsOwnerIdentity || '').trim();
    root.innerHTML = '';
    root.classList.toggle('u-display-none', false);

    const label = document.createElement('div');
    label.className = 'workspace-bulk-label';
    label.textContent = selectedCount
        ? `${selectedCount} selected`
        : 'Select conversations for bulk ownership changes';
    root.appendChild(label);

    const selectVisible = document.createElement('button');
    selectVisible.type = 'button';
    selectVisible.className = 'workspace-bulk-button workspace-bulk-button--secondary';
    selectVisible.textContent = 'Select Visible';
    selectVisible.disabled = bulkAssignmentInFlight || !conversations.length;
    selectVisible.addEventListener('click', () => {
        conversations.forEach((contact) => {
            const handle = String(contact?.handle || '').trim();
            if (handle) selectedConversationHandles.add(handle);
        });
        renderConversationsPage(conversations, false);
    });
    root.appendChild(selectVisible);

    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'workspace-bulk-button workspace-bulk-button--secondary';
    clear.textContent = 'Clear';
    clear.disabled = bulkAssignmentInFlight || !selectedCount;
    clear.addEventListener('click', () => {
        selectedConversationHandles.clear();
        renderConversationsPage(conversations, false);
    });
    root.appendChild(clear);

    const assign = document.createElement('button');
    assign.type = 'button';
    assign.className = 'workspace-bulk-button';
    assign.textContent = bulkAssignmentInFlight ? 'Saving...' : (ownerIdentity ? `Assign ${ownerIdentity}` : 'Assign Selected');
    assign.disabled = bulkAssignmentInFlight || !selectedCount || !ownerIdentity;
    assign.title = ownerIdentity ? `Assign selected conversations to ${ownerIdentity}` : 'Set "My owner name" to enable bulk assign';
    assign.addEventListener('click', () => {
        if (!ownerIdentity) return;
        void applyBulkConversationOwner(ownerIdentity, { successMessage: `Assigned ${selectedCount} conversation${selectedCount === 1 ? '' : 's'} to ${ownerIdentity}.` });
    });
    root.appendChild(assign);

    const unassign = document.createElement('button');
    unassign.type = 'button';
    unassign.className = 'workspace-bulk-button workspace-bulk-button--secondary';
    unassign.textContent = bulkAssignmentInFlight ? 'Saving...' : 'Unassign Selected';
    unassign.disabled = bulkAssignmentInFlight || !selectedCount;
    unassign.addEventListener('click', () => {
        void applyBulkConversationOwner('', { successMessage: `Unassigned ${selectedCount} conversation${selectedCount === 1 ? '' : 's'}.` });
    });
    root.appendChild(unassign);
}

function renderWorkspaceWorkloadSummary(meta = null) {
    const root = document.getElementById('workspace-workload-summary');
    if (!root) return;
    const source = meta || workspaceMetaCache;
    const segments = Array.isArray(source?.workloadSegments) ? source.workloadSegments : [];
    root.innerHTML = '';
    if (!segments.length) return;

    segments.forEach((segment) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'workspace-workload-card';
        const isActive =
            String(segment.ownerScope || '') === String(conversationsOwnerScope || '') &&
            String(segment.queue || '') === String(conversationsQueue || '');
        if (isActive) button.classList.add('is-active');
        button.title = `Show ${segment.label.toLowerCase()}`;
        button.addEventListener('click', () => {
            conversationsOwnerScope = normalizeWorkspaceOwnerScope(segment.ownerScope);
            conversationsQueue = normalizeWorkspaceQueue(segment.queue);
            contactOffset = 0;
            hasMoreContacts = true;
            loadConversations(false).catch((error) => console.error('Workspace workload reload failed:', error));
        });

        const count = document.createElement('div');
        count.className = 'workspace-workload-count';
        count.textContent = String(Number(segment.count) || 0);
        button.appendChild(count);

        const label = document.createElement('div');
        label.className = 'workspace-workload-label';
        label.textContent = segment.label;
        button.appendChild(label);

        root.appendChild(button);
    });
}

function renderWorkspaceSlaSummary(meta = null) {
    const root = document.getElementById('workspace-sla-summary');
    if (!root) return;
    const source = meta || workspaceMetaCache;
    const segments = Array.isArray(source?.slaSegments) ? source.slaSegments : [];
    root.innerHTML = '';
    if (!segments.length) return;

    segments.forEach((segment) => {
        const card = document.createElement('div');
        card.className = 'workspace-workload-card';

        const count = document.createElement('div');
        count.className = 'workspace-workload-count';
        count.textContent = String(Number(segment.count) || 0);
        card.appendChild(count);

        const label = document.createElement('div');
        label.className = 'workspace-workload-label';
        label.textContent = segment.label;
        card.appendChild(label);

        root.appendChild(card);
    });
}

async function updateConversationOwner(handle, nextOwner, button, successMessage) {
    const row = button?.closest('.contact-assignment-row') || null;
    const buttons = row ? Array.from(row.querySelectorAll('button')) : [];
    const idleLabel = button?.textContent || '';
    try {
        buttons.forEach((node) => { node.disabled = true; });
        if (button) button.textContent = 'Saving...';

        await saveKYC(handle, { owner: String(nextOwner || '').trim() }, { toastMessage: null });

        if (Array.isArray(window.conversations)) {
            const contact = window.conversations.find((entry) => entry && String(entry.handle) === String(handle));
            if (contact) contact.owner = String(nextOwner || '').trim();
        }

        if (typeof window.loadConversations === 'function') {
            await window.loadConversations(false);
        }
        if (window.currentHandle && String(window.currentHandle) === String(handle) && typeof window.loadKYCData === 'function') {
            await window.loadKYCData(handle);
        }
        UI.showToast(successMessage, 'success', 2200);
    } catch (error) {
        console.error('Conversation owner update failed:', error);
        UI.showToast(error?.message || 'Failed to update owner', 'error');
        buttons.forEach((node) => { node.disabled = false; });
        if (button) button.textContent = idleLabel;
    }
}

async function updateConversationMetadata(handle, data, button, successMessage, applyLocalUpdate) {
    const row = button?.closest('.contact-assignment-row') || button?.closest('.contact-escalation-row') || null;
    const buttons = row ? Array.from(row.querySelectorAll('button')) : [];
    const idleLabel = button?.textContent || '';
    try {
        buttons.forEach((node) => { node.disabled = true; });
        if (button) button.textContent = 'Saving...';

        await saveKYC(handle, data, { toastMessage: null });

        if (typeof applyLocalUpdate === 'function' && Array.isArray(window.conversations)) {
            const contact = window.conversations.find((entry) => entry && String(entry.handle) === String(handle));
            if (contact) applyLocalUpdate(contact);
        }

        if (typeof window.loadConversations === 'function') {
            await window.loadConversations(false);
        }
        if (window.currentHandle && String(window.currentHandle) === String(handle) && typeof window.loadKYCData === 'function') {
            await window.loadKYCData(handle);
        }
        UI.showToast(successMessage, 'success', 2200);
    } catch (error) {
        console.error('Conversation metadata update failed:', error);
        UI.showToast(error?.message || 'Failed to update conversation', 'error');
        buttons.forEach((node) => { node.disabled = false; });
        if (button) button.textContent = idleLabel;
    }
}

function conversationsCacheKey(query = conversationsQuery, sort = conversationsSort) {
    return `reply.conversations.${CONVERSATIONS_CACHE_VERSION}.${String(query || '').trim().toLowerCase()}::${normalizeConversationSort(sort)}::${normalizeWorkspaceQueue(conversationsQueue)}::${normalizeWorkspaceChannel(conversationsChannel)}::${normalizeWorkspaceOwnerScope(conversationsOwnerScope)}::${String(conversationsOwnerIdentity || '').trim().toLowerCase()}`;
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
    const oldestRankMap = computeOldestActionableRankMap(append ? conversations : contacts);

    if (!append) {
        contactListEl.innerHTML = '';
    }

    contacts.forEach(contact => {
        const item = document.createElement('div');
        item.className = 'sidebar-item';
        item.dataset.handle = contact.handle;
        const isSelected = selectedConversationHandles.has(String(contact.handle || '').trim());
        item.classList.toggle('is-selected', isSelected);
        if (window.currentHandle && (String(window.currentHandle) === String(contact.handle) || String(window.currentHandle) === String(contact.latestHandle || ''))) {
            item.classList.add('active');
        }

        const selectPrefix = document.createElement('div');
        selectPrefix.className = 'contact-row-prefix';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'contact-select-checkbox';
        checkbox.checked = isSelected;
        checkbox.setAttribute('aria-label', `Select ${rawLabelForContact(contact)}`);
        checkbox.addEventListener('click', (event) => event.stopPropagation());
        checkbox.addEventListener('change', (event) => {
            event.stopPropagation();
            toggleConversationSelection(contact.handle, checkbox.checked);
            item.classList.toggle('is-selected', checkbox.checked);
        });
        selectPrefix.appendChild(checkbox);
        item.appendChild(selectPrefix);

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
        const rawLabel = rawLabelForContact(contact);
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

        const owner = String(contact.owner || '').trim();
        const flags = Array.isArray(contact.customerFlags) ? contact.customerFlags : [];
        const ownerIdentity = String(conversationsOwnerIdentity || '').trim();
        const hasOwner = Boolean(owner);
        const isMine = hasOwner && sameOwnerIdentity(owner, ownerIdentity);
        const workspaceAge = contact.workspaceAge || {};
        const workspaceQueue = String(contact?.workspace?.queueKey || '').trim();
        const staleRank = oldestRankMap.get(String(contact.handle || '').trim()) || 0;
        const isActionable = workspaceQueue === 'needs_reply' || workspaceQueue === 'draft_ready' || workspaceQueue === 'escalated';
        const isSlaWarning = isActionable && Number(workspaceAge.ageHours || 0) >= 1;
        const isSlaCritical = isActionable && Number(workspaceAge.ageHours || 0) >= 24;
        const normalizedFlags = normalizeFlagList(flags);
        const isEscalated = normalizedFlags.includes('escalated');
        if (isSlaCritical) item.classList.add('sidebar-item--sla-critical');
        else if (isSlaWarning) item.classList.add('sidebar-item--sla-warning');
        if (owner || flags.length) {
            const metaRow = document.createElement('div');
            metaRow.className = 'contact-meta-row';
            if (owner) {
                const ownerBadge = document.createElement('div');
                ownerBadge.className = 'contact-meta-badge';
                ownerBadge.textContent = `Owner: ${owner}`;
                ownerBadge.title = `Owner: ${owner}`;
                metaRow.appendChild(ownerBadge);
            }
            flags.slice(0, 3).forEach((flag) => {
                const flagBadge = document.createElement('div');
                flagBadge.className = 'contact-meta-badge contact-meta-badge--flag';
                flagBadge.textContent = flag;
                flagBadge.title = `Customer flag: ${flag}`;
                metaRow.appendChild(flagBadge);
            });
            info.appendChild(metaRow);
        }

        if (staleRank || isSlaWarning) {
            const slaRow = document.createElement('div');
            slaRow.className = 'contact-meta-row contact-meta-row--sla';

            if (staleRank) {
                const rankBadge = document.createElement('div');
                rankBadge.className = 'contact-meta-badge contact-meta-badge--sla';
                rankBadge.textContent = staleRank === 1 ? 'Oldest' : `Stale #${staleRank}`;
                rankBadge.title = `Visible actionable stale rank #${staleRank}`;
                slaRow.appendChild(rankBadge);
            }

            if (isSlaWarning) {
                const ageBadge = document.createElement('div');
                ageBadge.className = `contact-meta-badge contact-meta-badge--sla ${isSlaCritical ? 'contact-meta-badge--sla-critical' : ''}`;
                ageBadge.textContent = isSlaCritical ? `SLA ${formatAgeHoursLabel(workspaceAge.ageHours)}` : formatAgeHoursLabel(workspaceAge.ageHours);
                ageBadge.title = workspaceAge.pendingSinceAt
                    ? `Pending since ${workspaceAge.pendingSinceAt}`
                    : 'Actionable conversation age';
                slaRow.appendChild(ageBadge);
            }

            info.appendChild(slaRow);
        }

        if ((workspaceQueue === 'needs_reply' || workspaceQueue === 'escalated') && isSlaWarning) {
            const escalationRow = document.createElement('div');
            escalationRow.className = 'contact-assignment-row contact-escalation-row';

            if (ownerIdentity && !isMine) {
                const reassignButton = document.createElement('button');
                reassignButton.type = 'button';
                reassignButton.className = 'contact-assignment-button';
                reassignButton.textContent = 'Reassign to Me';
                reassignButton.title = `Assign this stale conversation to ${ownerIdentity}`;
                reassignButton.addEventListener('click', (event) => {
                    event.stopPropagation();
                    void updateConversationOwner(contact.handle, ownerIdentity, reassignButton, `Assigned to ${ownerIdentity}.`);
                });
                escalationRow.appendChild(reassignButton);
            }

            if (!isEscalated) {
                const escalateButton = document.createElement('button');
                escalateButton.type = 'button';
                escalateButton.className = 'contact-assignment-button contact-assignment-button--danger';
                escalateButton.textContent = 'Escalate';
                escalateButton.title = 'Mark this conversation as escalated';
                escalateButton.addEventListener('click', (event) => {
                    event.stopPropagation();
                    const nextFlags = normalizeFlagList([...normalizedFlags, 'escalated']);
                    void updateConversationMetadata(
                        contact.handle,
                        { customerFlags: nextFlags },
                        escalateButton,
                        'Conversation escalated.',
                        (entry) => { entry.customerFlags = nextFlags; }
                    );
                });
                escalationRow.appendChild(escalateButton);
            }

            if (escalationRow.childNodes.length) {
                info.appendChild(escalationRow);
            }
        }

        if (ownerIdentity || hasOwner) {
            const actionRow = document.createElement('div');
            actionRow.className = 'contact-assignment-row';

            if (ownerIdentity && !isMine) {
                const assignButton = document.createElement('button');
                assignButton.type = 'button';
                assignButton.className = 'contact-assignment-button';
                assignButton.textContent = hasOwner ? 'Assign Me' : 'Claim';
                assignButton.title = ownerIdentity
                    ? `Assign this conversation to ${ownerIdentity}`
                    : 'Assign this conversation';
                assignButton.addEventListener('click', (event) => {
                    event.stopPropagation();
                    void updateConversationOwner(contact.handle, ownerIdentity, assignButton, `Assigned to ${ownerIdentity}.`);
                });
                actionRow.appendChild(assignButton);
            }

            if (hasOwner) {
                const unassignButton = document.createElement('button');
                unassignButton.type = 'button';
                unassignButton.className = 'contact-assignment-button contact-assignment-button--secondary';
                unassignButton.textContent = 'Unassign';
                unassignButton.title = 'Clear the current owner';
                unassignButton.addEventListener('click', (event) => {
                    event.stopPropagation();
                    void updateConversationOwner(contact.handle, '', unassignButton, 'Conversation unassigned.');
                });
                actionRow.appendChild(unassignButton);
            }

            if (actionRow.childNodes.length) {
                info.appendChild(actionRow);
            }
        }

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

    renderWorkspaceBulkActions();

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

function rawLabelForContact(contact) {
    return formatContactLabel(
        contact?.presentationDisplayName || contact?.displayName || contact?.name || contact?.handle
    );
}

function normalizeWorkspaceQueue(mode) {
    const m = String(mode || 'all').toLowerCase().trim();
    return new Set(['all', 'escalated', 'needs_reply', 'draft_ready', 'waiting_on_contact', 'resolved']).has(m) ? m : 'all';
}

function normalizeWorkspaceChannel(mode) {
    return String(mode || 'all').toLowerCase().trim() || 'all';
}

function normalizeWorkspaceOwnerScope(mode) {
    const m = String(mode || 'all').toLowerCase().trim();
    return new Set(['all', 'mine', 'team', 'unassigned']).has(m) ? m : 'all';
}

function readWorkspaceOwnerIdentity() {
    try {
        return String(window.localStorage?.getItem(WORKSPACE_OWNER_STORAGE_KEY) || '').trim();
    } catch {
        return '';
    }
}

function persistWorkspaceOwnerIdentity(value) {
    try {
        const normalized = String(value || '').trim();
        if (!window.localStorage) return;
        if (normalized) window.localStorage.setItem(WORKSPACE_OWNER_STORAGE_KEY, normalized);
        else window.localStorage.removeItem(WORKSPACE_OWNER_STORAGE_KEY);
    } catch {
        // Non-blocking workspace preference only.
    }
}

function ensureWorkspaceOwnerControlsBound() {
    const input = document.getElementById('workspace-owner-identity');
    if (!input) return;
    if (!conversationsOwnerIdentity) {
        conversationsOwnerIdentity = readWorkspaceOwnerIdentity();
    }
    if (input.value !== conversationsOwnerIdentity) {
        input.value = conversationsOwnerIdentity;
    }
    if (input.dataset.bound === '1') return;
    input.dataset.bound = '1';
    input.addEventListener('input', () => {
        const nextValue = String(input.value || '').trim();
        conversationsOwnerIdentity = nextValue;
        persistWorkspaceOwnerIdentity(nextValue);
        if (workspaceOwnerReloadTimer) window.clearTimeout(workspaceOwnerReloadTimer);
        workspaceOwnerReloadTimer = window.setTimeout(() => {
            contactOffset = 0;
            hasMoreContacts = true;
            loadConversations(false).catch((error) => console.error('Workspace owner reload failed:', error));
        }, 180);
    });
}

function renderWorkspaceFilters(meta = null) {
    workspaceMetaCache = meta || workspaceMetaCache;
    const queueEl = document.getElementById('workspace-queue-filters');
    const channelEl = document.getElementById('workspace-channel-filters');
    const ownerEl = document.getElementById('workspace-owner-filters');
    ensureWorkspaceOwnerControlsBound();
    if (!queueEl || !channelEl || !ownerEl || !workspaceMetaCache) return;

    conversationsOwnerIdentity = String(workspaceMetaCache.ownerIdentity || conversationsOwnerIdentity || '').trim();
    const ownerInput = document.getElementById('workspace-owner-identity');
    if (ownerInput && ownerInput.value !== conversationsOwnerIdentity) {
        ownerInput.value = conversationsOwnerIdentity;
    }
    renderWorkspaceWorkloadSummary(workspaceMetaCache);
    renderWorkspaceSlaSummary(workspaceMetaCache);

    const ownerButtons = Array.isArray(workspaceMetaCache.availableOwnerScopes) ? workspaceMetaCache.availableOwnerScopes : [];
    ownerEl.innerHTML = '';
    ownerButtons.forEach((entry) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `workspace-filter-chip workspace-filter-chip--scope ${entry.key === conversationsOwnerScope ? 'is-active' : ''}`;
        button.textContent = `${entry.label} ${entry.count}`;
        button.dataset.ownerScope = entry.key;
        button.addEventListener('click', () => {
            if (conversationsOwnerScope === entry.key) return;
            conversationsOwnerScope = normalizeWorkspaceOwnerScope(entry.key);
            contactOffset = 0;
            hasMoreContacts = true;
            loadConversations(false).catch((error) => console.error('Workspace owner scope reload failed:', error));
        });
        ownerEl.appendChild(button);
    });

    const queueButtons = Array.isArray(workspaceMetaCache.availableQueues) ? workspaceMetaCache.availableQueues : [];
    queueEl.innerHTML = '';
    queueButtons.forEach((entry) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `workspace-filter-chip ${entry.key === conversationsQueue ? 'is-active' : ''}`;
        button.textContent = `${entry.label} ${entry.count}`;
        button.dataset.queue = entry.key;
        button.addEventListener('click', () => {
            if (conversationsQueue === entry.key) return;
            conversationsQueue = normalizeWorkspaceQueue(entry.key);
            contactOffset = 0;
            hasMoreContacts = true;
            loadConversations(false).catch((error) => console.error('Workspace queue reload failed:', error));
        });
        queueEl.appendChild(button);
    });

    const channelButtons = Array.isArray(workspaceMetaCache.availableChannels) ? workspaceMetaCache.availableChannels : [];
    channelEl.innerHTML = '';
    channelButtons.forEach((entry) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `workspace-filter-chip workspace-filter-chip--subtle ${entry.key === conversationsChannel ? 'is-active' : ''}`;
        button.textContent = `${entry.label} ${entry.count}`;
        button.dataset.channel = entry.key;
        button.addEventListener('click', () => {
            if (conversationsChannel === entry.key) return;
            conversationsChannel = normalizeWorkspaceChannel(entry.key);
            contactOffset = 0;
            hasMoreContacts = true;
            loadConversations(false).catch((error) => console.error('Workspace channel reload failed:', error));
        });
        channelEl.appendChild(button);
    });
}

async function refreshConversationsFromServer(append = false) {
    const contactListEl = document.getElementById('contact-list');
    if (!contactListEl) return;

    const data = await fetchConversations(
        contactOffset,
        CONTACT_LIMIT,
        conversationsQuery,
        conversationsSort,
        conversationsQueue,
        conversationsChannel,
        conversationsOwnerScope,
        conversationsOwnerIdentity,
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
    renderWorkspaceFilters(data?.meta?.workspace || null);

    hasMoreContacts = data.hasMore;

    if (append) {
        conversations = [...conversations, ...data.contacts];
    } else {
        conversations = data.contacts;
    }
    window.conversations = conversations;
    pruneSelectedConversationHandles();

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
    ensureWorkspaceOwnerControlsBound();

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
                pruneSelectedConversationHandles();
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

export async function setWorkspaceQueue(mode) {
    conversationsQueue = normalizeWorkspaceQueue(mode);
    contactOffset = 0;
    hasMoreContacts = true;
    return await loadConversations(false);
}

export async function setWorkspaceChannel(mode) {
    conversationsChannel = normalizeWorkspaceChannel(mode);
    contactOffset = 0;
    hasMoreContacts = true;
    return await loadConversations(false);
}

export async function setWorkspaceOwnerScope(mode) {
    conversationsOwnerScope = normalizeWorkspaceOwnerScope(mode);
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

    try {
        if (typeof window.applyCachedSuggestionForHandle === 'function') {
            window.applyCachedSuggestionForHandle(handle, { force: false });
        }
        if (typeof window.hydratePreparedDraftForHandle === 'function') {
            void window.hydratePreparedDraftForHandle(handle, { refresh: true, force: true });
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
