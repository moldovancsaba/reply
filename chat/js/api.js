/**
 * {reply} - API Layer
 * Handles all HTTP requests to the backend server
 */

import { UI } from './ui.js';

const API_BASE = '';

async function _request(url, options = {}) {
    const isMutation = options.method && options.method !== 'GET';
    const showLoading = Boolean(options._showLoading) || isMutation;
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
        const skipToast =
            options._silent ||
            options.delegateErrorUI ||
            err._replyErrorUiShown;
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
        _showLoading: !!showLoadingUi,
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
        _showLoading: !!showLoadingUi,
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
 * Report the outcome of a {hatori} suggestion back to the intelligence engine.
 * status: 'sent_as_is' | 'edited_then_sent'
 * Fires as background (no await needed by callers).
 */
export async function reportHatoriOutcome({
    hatori_id,
    original_text,
    final_sent_text,
    statusOverride = null,
    platform = 'other',
    recipient_id = '',
    conversation_id = '',
    edit_reason = ''
}) {
    if (!hatori_id) return; // Nothing to report if this message didn't originate from {hatori}

    const isSentAsIs = original_text === final_sent_text ||
        Math.abs(original_text.length - final_sent_text.length) <= 2;
    const status = statusOverride || (isSentAsIs ? 'sent_as_is' : 'edited_then_sent');

    try {
        await fetch(`${API_BASE}/api/hatori/outcome`, {
            method: 'POST',
            headers: buildSecurityHeaders(),
            body: JSON.stringify({
                external_outcome_id: `reply:outcome-${Date.now()}`,
                assistant_interaction_id: hatori_id,
                status,
                platform,
                recipient_id,
                conversation_id,
                original_text,
                final_sent_text,
                edit_reason: edit_reason || (status === 'not_sent' ? 'replaced_via_suggest' : ''),
                diff: status === 'edited_then_sent' ? `${original_text} -> ${final_sent_text}` : null
            })
        });
    } catch (e) {
        console.warn('[{reply}] Hatori annotation failed (non-blocking):', e.message);
    }
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

/**
 * Send a message to a contact
 * @param {string} handle - Contact handle
 * @param {string} text - Message text
 * @param {string} channel - Channel to use (only imessage/email/whatsapp are send-enabled)
 * @param {object} hatoriContext - Optional {hatori} draft context for annotation { hatori_id, original_draft }
 * @returns {Promise<Object>} Send result
 */
export async function sendMessage(handle, text, channel = 'imessage', hatoriContext = null) {
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
        body: JSON.stringify(withApproval(sendPayload, 'ui-send-message')),
        /** Caller (`handleSendMessage`) shows one consolidated error toast */
        delegateErrorUI: true,
    });

    const data = await res.json();
    UI.showToast('Message sent!', 'success');

    // Fire-and-forget annotation to {hatori} (does not block the send UI)
    if (hatoriContext && hatoriContext.hatori_id) {
        reportHatoriOutcome({
            hatori_id: hatoriContext.hatori_id,
            original_text: hatoriContext.original_draft || '',
            final_sent_text: text,
            platform: ch,
            recipient_id: handle,
            conversation_id: `reply:${handle}`
        });
    }

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
