/**
 * {reply} - API Layer
 * Handles all HTTP requests to the backend server
 */

import { UI } from './ui.js';

const API_BASE = '';

async function _request(url, options = {}) {
    const isMutation = options.method && options.method !== 'GET';
    // Global blocking overlays are opt-in only. Mutations should generally
    // keep the workspace interactive and surface progress inline/per-action.
    const showLoading = Boolean(options._showLoading);
    if (showLoading) UI.showLoading();

    try {
        const res = await fetch(url, options);
        if (!res.ok) {
            let errorMsg = `Error: ${res.status} ${res.statusText}`;
            try {
                const data = await res.json().catch(() => ({}));
                errorMsg = data.error || data.message || errorMsg;
                const hint = data.hint && String(data.hint).trim();
                if (hint) {
                    errorMsg = `${errorMsg}\n\n${hint}`;
                }
            } catch (e) { }
            const httpErr = new Error(errorMsg);
            if (options.delegateErrorUI) {
                throw httpErr;
            }
            UI.showToast(errorMsg, 'error');
            httpErr._replyErrorUiShown = true;
            throw httpErr;
        }
        return res;
    } catch (err) {
        const msg = err.message || 'Network error';
        const reconnecting =
            /load failed|networkerror|failed to fetch|network request failed/i.test(msg);
        const skipToast =
            options._silent ||
            options.delegateErrorUI ||
            err._replyErrorUiShown ||
            reconnecting;
        if (!skipToast) UI.showToast(msg, 'error');
        throw err;
    } finally {
        if (showLoading) UI.hideLoading();
    }
}

/**
 * @param {{ includeJsonContentType?: boolean }} [options] - Set includeJsonContentType: false for GET requests (avoids odd browser behavior with JSON Content-Type on no-body requests).
 */
export function buildSecurityHeaders(options = {}) {
    const opts = options && typeof options === 'object' ? options : {};
    const includeJsonContentType = opts.includeJsonContentType !== false;
    const headers = { 'X-Reply-Human-Approval': 'confirmed' };
    if (includeJsonContentType) {
        headers['Content-Type'] = 'application/json';
    }
    const token = window.REPLY_OPERATOR_TOKEN || (window.localStorage && window.localStorage.getItem('replyOperatorToken'));
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

function normalizeErrorText(raw, fallback = '') {
    let text = String(raw || '').trim();
    while (/^error:\s*/i.test(text)) {
        text = text.replace(/^error:\s*/i, '').trim();
    }
    text = text.replace(/\s+/g, ' ').trim();
    return text || fallback;
}

/**
 * Fetch paginated list of conversations/contacts
 * @param {number} offset - Starting index for pagination
 * @param {number} limit - Number of contacts to fetch
 * @param {string} query - Optional search query
 * @param {boolean} [showLoadingUi=true] — Set false for pagination appends (no global spinner).
 * @returns {Promise<{contacts: Array, hasMore: boolean, total: number}>}
 */
export async function fetchConversations(offset = 0, limit = 20, query = '', sort = 'newest', showLoadingUi = true) {
    const q = (query || '').toString().trim();
    const s = (sort || 'newest').toString().trim() || 'newest';
    const params = new URLSearchParams({ offset: String(offset), limit: String(limit), sort: s });
    if (q) params.set('q', q);
    const res = await _request(`${API_BASE}/api/conversations?${params.toString()}`, {
        headers: buildSecurityHeaders(),
        _silent: true,
        _showLoading: false,
    });
    return await res.json();
}

/**
 * Fetch message thread for a specific contact
 * @param {string} handle - Contact handle (phone/email)
 * @param {number} offset - Starting index for pagination
 * @param {number} limit - Number of messages to fetch
 * @param {boolean} [showLoadingUi=true] — Set false when appending older messages (infinite scroll).
 * @returns {Promise<Array>} Array of message objects
 */
export async function fetchMessages(handle, offset = 0, limit = 30, showLoadingUi = true) {
    const res = await _request(`${API_BASE}/api/thread?handle=${encodeURIComponent(handle)}&offset=${offset}&limit=${limit}`, {
        headers: buildSecurityHeaders(),
        _silent: true,
        _showLoading: false,
    });
    const data = await res.json();
    return data.messages || [];
}

/**
 * Fetch system health and sync status for dashboard
 * @param {{ silent?: boolean }} [options] - silent: suppress error toasts (e.g. first-run onboarding probe).
 * @returns {Promise<Object>} System health data
 */
export async function fetchSystemHealth(options = {}) {
    const res = await _request(`${API_BASE}/api/system-health`, {
        headers: buildSecurityHeaders(),
        _silent: options.silent === true,
    });
    return await res.json();
}

/**
 * Fetch OpenClaw gateway status via proxy
 * @returns {Promise<Object>} OpenClaw status data
 */
export async function fetchOpenClawStatus() {
    const res = await fetch(`${API_BASE}/api/openclaw/status`, {
        headers: buildSecurityHeaders(),
    });
    // We don't throw on error here because many errors are expected (gateway offline)
    // and handled gracefully by the UI via JSON content.
    const data = await res.json();
    const normalizedStatus = String(data?.status || '').toLowerCase();
    if (normalizedStatus === 'live' || (data?.ok === true && normalizedStatus !== 'offline')) {
        return { ...data, status: 'online' };
    }
    return data;
}

/**
 * Fetch triage log entries for dashboard
 * @param {number} limit - Number of entries to fetch
 * @returns {Promise<Array>} Triage log entries
 */
export async function fetchTriageLogs(limit = 10) {
    const res = await _request(`${API_BASE}/api/triage-log?limit=${limit}`, {
        headers: buildSecurityHeaders(),
    });
    const data = await res.json();
    return data.logs || [];
}

/** Priority-sorted triage queue (deduped by sender) for dashboard zero-inbox (reply#24). */
export async function fetchTriageQueue(limit = 15) {
    const res = await _request(`${API_BASE}/api/triage-queue?limit=${limit}`, {
        headers: buildSecurityHeaders(),
        _silent: true,
        _showLoading: false
    });
    const data = await res.json();
    return data.queue || [];
}

export async function fetchBridgeEvents(limit = 20) {
    const n = Math.max(1, Math.min(Number(limit) || 20, 500));
    const res = await _request(`${API_BASE}/api/channel-bridge/events?limit=${n}`, {
        headers: buildSecurityHeaders(),
    });
    return await res.json();
}

export async function fetchBridgeSummary(limit = 200) {
    const n = Math.max(1, Math.min(Number(limit) || 200, 2000));
    const res = await _request(`${API_BASE}/api/channel-bridge/summary?limit=${n}`, {
        headers: buildSecurityHeaders(),
    });
    return await res.json();
}

export async function reportDraftReplacement({ handle, original_text, reason = 'suggest_replace' }) {
    if (!original_text || !String(original_text).trim()) return;
    try {
        await fetch(`${API_BASE}/api/feedback`, {
            method: 'POST',
            headers: buildSecurityHeaders(),
            body: JSON.stringify({
                type: 'draft_replaced',
                reason,
                handle: handle || '',
                original_text,
                timestamp: new Date().toISOString(),
            }),
        });
    } catch (e) {
        console.warn('[{reply}] Draft replacement feedback failed (non-blocking):', e.message);
    }
}

export async function reportTrinityOutcome(outcome) {
    if (!outcome || !outcome.cycle_id) return { status: 'skipped' };
    const res = await _request(`${API_BASE}/api/feedback`, {
        method: 'POST',
        headers: buildSecurityHeaders(),
        body: JSON.stringify({
            type: 'trinity_draft_outcome',
            outcome,
        }),
        _silent: true,
        _showLoading: false,
    });
    return res.json();
}

/**
 * Send a message to a contact
 * @param {string} handle - Contact handle
 * @param {string} text - Message text
 * @param {string} channel - Channel to use (only imessage/email/whatsapp are send-enabled)
 * @returns {Promise<Object>} Send result
 */
export async function sendMessage(handle, text, channel = 'imessage', draftContext = null) {
    const ch = (channel || 'imessage').toString().toLowerCase();
    const endpointByChannel = {
        imessage: '/api/send-imessage',
        whatsapp: '/api/send-whatsapp',
        linkedin: '/api/send-linkedin',
        email: '/api/send-email',
    };
    const endpoint = endpointByChannel[ch];
    if (!endpoint) {
        throw new Error(`Outbound send is disabled for channel "${ch}" (draft-only or unsupported).`);
    }

    const sendTrigger = {
        kind: 'human_enter',
        at: new Date().toISOString(),
    };
    const sendPayload = { recipient: handle, text, trigger: sendTrigger };
    if (draftContext) {
        sendPayload.draftContext = draftContext;
    }
    if (ch === 'whatsapp') {
        // Server picks transport from REPLY_WHATSAPP_SEND_TRANSPORT (default: desktop); OpenClaw may fall back to desktop.
        sendPayload.allowDesktopFallback = true;
    }

    const res = await _request(endpoint, {
        method: 'POST',
        headers: buildSecurityHeaders(),
        body: JSON.stringify(withApproval(sendPayload, 'ui-send-message')),
        /** Caller (`handleSendMessage`) shows one consolidated error toast */
        delegateErrorUI: true,
    });

    const data = await res.json();
    UI.showToast('Message sent!', 'success');

    return data;
}

/**
 * Load KYC profile for a contact
 * @param {string} handle - Contact handle
 * @returns {Promise<Object>} KYC profile data
 */
export async function loadKYC(handle) {
    const res = await _request(`${API_BASE}/api/kyc?handle=${encodeURIComponent(handle)}`, {
        headers: buildSecurityHeaders(),
    });
    return await res.json();
}

/**
 * Save KYC profile for a contact
 * @param {string} handle - Contact handle
 * @param {Object} data - KYC profile data
 * @returns {Promise<Object>} Save result
 */
export async function saveKYC(handle, data) {
    const res = await _request(`${API_BASE}/api/kyc`, {
        method: 'POST',
        headers: buildSecurityHeaders(),
        body: JSON.stringify(withApproval({ handle, ...data }, 'ui-save-kyc'))
    });
    const result = await res.json();
    UI.showToast('Profile saved!', 'success');
    return result;
}

/**
 * Merge source contact into target contact
 * @param {string} targetId - The ID of the primary identity
 * @param {string} sourceId - The ID of the alias profile
 */
export async function mergeContacts(targetId, sourceId) {
    const res = await _request(`${API_BASE}/api/contacts/merge`, {
        method: 'POST',
        headers: buildSecurityHeaders(),
        body: JSON.stringify(withApproval({ targetId, sourceId }, 'ui-merge-contact'))
    });
    const data = await res.json();
    UI.showToast('Contacts merged!', 'success');
    return data;
}

/**
 * List alias rows (`primary_contact_id`) for the canonical profile behind this handle/id (reply#19).
 * @param {string} forKey - `kyc-handle-input` value or row id (`id-…`)
 */
export async function listContactAliases(forKey) {
    const res = await _request(`${API_BASE}/api/contacts/aliases?for=${encodeURIComponent(forKey)}`, {
        method: 'GET',
        headers: buildSecurityHeaders({ includeJsonContentType: false }),
        _silent: true,
        _showLoading: false
    });
    return res.json();
}

/** Clear merge link on one alias row (channels stay on primary). */
export async function unlinkContactAlias(aliasContactId) {
    const res = await _request(`${API_BASE}/api/contacts/unlink-alias`, {
        method: 'POST',
        headers: buildSecurityHeaders(),
        body: JSON.stringify(withApproval({ aliasContactId }, 'ui-unlink-contact-alias'))
    });
    return res.json();
}

/**
 * Trigger a sync for a specific source
 * @param {string} source - Source to sync ('imessage', 'whatsapp', 'notes')
 * @returns {Promise<Object>} Sync result
 */
export async function triggerSync(source) {
    const endpoint = `/api/sync-${source}`;
    const res = await _request(endpoint, {
        method: 'POST',
        headers: buildSecurityHeaders(),
        body: JSON.stringify(withApproval({ source }, `ui-sync-${source}`)),
    });
    const data = await res.json();
    UI.showToast(`${source.toUpperCase()} sync complete!`, 'success');
    return data;
}

/**
 * Load UI settings (local-only)
 * @returns {Promise<Object>}
 */
export async function getSettings() {
    const res = await _request(`${API_BASE}/api/settings`, {
        headers: buildSecurityHeaders(),
    });
    return await res.json();
}

/**
 * Save UI settings (local-only)
 * @param {Object} data
 * @returns {Promise<Object>}
 */
export async function saveSettings(data) {
    const res = await _request(`${API_BASE}/api/settings`, {
        method: 'POST',
        headers: buildSecurityHeaders(),
        body: JSON.stringify(withApproval(data || {}, 'ui-save-settings'))
    });
    const result = await res.json();
    UI.showToast('Settings saved!', 'success');
    return result;
}

export async function getGmailAuthUrl() {
    const res = await _request(`${API_BASE}/api/gmail/auth-url`, {
        headers: buildSecurityHeaders(),
    });
    return await res.json();
}

export async function disconnectGmail() {
    const res = await _request(`${API_BASE}/api/gmail/disconnect`, {
        method: 'POST',
        headers: buildSecurityHeaders(),
        body: JSON.stringify(withApproval({}, 'ui-disconnect-gmail')),
    });
    const data = await res.json();
    UI.showToast('Gmail disconnected!', 'success');
    return data;
}

export async function controlService(name, action) {
    const res = await fetch('/api/system/service/control', {
        method: 'POST',
        headers: buildSecurityHeaders(),
        body: JSON.stringify({ name, action })
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to control service');
    }
    return res.json();
}
