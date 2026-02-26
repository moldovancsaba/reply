/**
 * {reply} - API Layer
 * Handles all HTTP requests to the backend server
 */

import { UI } from './ui.js';

const API_BASE = '';

async function _request(url, options = {}) {
    const isMutation = options.method && options.method !== 'GET';
    if (isMutation) UI.showLoading();

    try {
        const res = await fetch(url, options);
        if (!res.ok) {
            let errorMsg = `Error: ${res.status} ${res.statusText}`;
            try {
                const data = await res.json().catch(() => ({}));
                errorMsg = data.error || data.message || errorMsg;
            } catch (e) { }
            UI.showToast(errorMsg, 'error');
            throw new Error(errorMsg);
        }
        return res;
    } catch (err) {
        const msg = err.message || 'Network error';
        if (!options._silent) UI.showToast(msg, 'error');
        throw err;
    } finally {
        if (isMutation) UI.hideLoading();
    }
}

export function buildSecurityHeaders() {
    const headers = { 'Content-Type': 'application/json', 'X-Reply-Human-Approval': 'confirmed' };
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
 * @returns {Promise<{contacts: Array, hasMore: boolean, total: number}>}
 */
export async function fetchConversations(offset = 0, limit = 20, query = '') {
    const q = (query || '').toString().trim();
    const url = q
        ? `${API_BASE}/api/conversations?offset=${offset}&limit=${limit}&q=${encodeURIComponent(q)}`
        : `${API_BASE}/api/conversations?offset=${offset}&limit=${limit}`;
    const res = await _request(url, { headers: buildSecurityHeaders(), _silent: true });
    return await res.json();
}

/**
 * Fetch message thread for a specific contact
 * @param {string} handle - Contact handle (phone/email)
 * @param {number} offset - Starting index for pagination
 * @param {number} limit - Number of messages to fetch
 * @returns {Promise<Array>} Array of message objects
 */
export async function fetchMessages(handle, offset = 0, limit = 30) {
    const res = await _request(`${API_BASE}/api/thread?handle=${encodeURIComponent(handle)}&offset=${offset}&limit=${limit}`, {
        headers: buildSecurityHeaders(),
        _silent: true
    });
    const data = await res.json();
    return data.messages || [];
}

/**
 * Fetch system health and sync status for dashboard
 * @returns {Promise<Object>} System health data
 */
export async function fetchSystemHealth() {
    const res = await _request(`${API_BASE}/api/system-health`, {
        headers: buildSecurityHeaders(),
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
    return await res.json();
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

/**
 * Send a message to a contact
 * @param {string} handle - Contact handle
 * @param {string} text - Message text
 * @param {string} channel - Channel to use (only imessage/email/whatsapp are send-enabled)
 * @returns {Promise<Object>} Send result
 */
export async function sendMessage(handle, text, channel = 'imessage') {
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
    if (ch === 'whatsapp') {
        sendPayload.transport = 'openclaw_cli';
        sendPayload.allowDesktopFallback = false;
    }

    const res = await _request(endpoint, {
        method: 'POST',
        headers: buildSecurityHeaders(),
        body: JSON.stringify(withApproval(sendPayload, 'ui-send-message'))
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
