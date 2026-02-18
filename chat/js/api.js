/**
 * {reply} - API Layer
 * Handles all HTTP requests to the backend server
 */

const API_BASE = '';

function buildSecurityHeaders() {
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
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch conversations: ${res.statusText}`);
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
    const res = await fetch(`${API_BASE}/api/thread?handle=${encodeURIComponent(handle)}&offset=${offset}&limit=${limit}`);
    if (!res.ok) throw new Error(`Failed to fetch messages: ${res.statusText}`);
    const data = await res.json();
    return data.messages || [];
}

/**
 * Fetch system health and sync status for dashboard
 * @returns {Promise<Object>} System health data
 */
export async function fetchSystemHealth() {
    const res = await fetch(`${API_BASE}/api/system-health`);
    if (!res.ok) throw new Error(`Failed to fetch system health: ${res.statusText}`);
    return await res.json();
}

/**
 * Fetch triage log entries for dashboard
 * @param {number} limit - Number of entries to fetch
 * @returns {Promise<Array>} Triage log entries
 */
export async function fetchTriageLogs(limit = 10) {
    const res = await fetch(`${API_BASE}/api/triage-log?limit=${limit}`);
    if (!res.ok) throw new Error(`Failed to fetch triage logs: ${res.statusText}`);
    const data = await res.json();
    return data.logs || [];
}

export async function fetchBridgeEvents(limit = 20) {
    const n = Math.max(1, Math.min(Number(limit) || 20, 500));
    const res = await fetch(`${API_BASE}/api/channel-bridge/events?limit=${n}`);
    if (!res.ok) throw new Error(`Failed to fetch channel bridge events: ${res.statusText}`);
    return await res.json();
}

export async function fetchBridgeSummary(limit = 200) {
    const n = Math.max(1, Math.min(Number(limit) || 200, 2000));
    const res = await fetch(`${API_BASE}/api/channel-bridge/summary?limit=${n}`);
    if (!res.ok) throw new Error(`Failed to fetch channel bridge summary: ${res.statusText}`);
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
        email: '/api/send-email',
    };
    const endpoint = endpointByChannel[ch];
    if (!endpoint) {
        throw new Error(`Outbound send is disabled for channel "${ch}" (draft-only or unsupported).`);
    }
    const res = await fetch(endpoint, {
        method: 'POST',
        headers: buildSecurityHeaders(),
        body: JSON.stringify(withApproval({ recipient: handle, text }, 'ui-send-message'))
    });
    if (!res.ok) {
        let detail = '';
        try {
            const raw = await res.text();
            try {
                const j = JSON.parse(raw);
                detail = j?.error || j?.message || j?.hint || raw;
            } catch {
                detail = raw;
            }
        } catch { }
        const msg = detail ? `Failed to send message: ${detail}` : `Failed to send message: ${res.status} ${res.statusText}`;
        throw new Error(msg);
    }
    return await res.json();
}

/**
 * Load KYC profile for a contact
 * @param {string} handle - Contact handle
 * @returns {Promise<Object>} KYC profile data
 */
export async function loadKYC(handle) {
    const res = await fetch(`${API_BASE}/api/kyc?handle=${encodeURIComponent(handle)}`);
    if (!res.ok) throw new Error(`Failed to load KYC: ${res.statusText}`);
    return await res.json();
}

/**
 * Save KYC profile for a contact
 * @param {string} handle - Contact handle
 * @param {Object} data - KYC profile data
 * @returns {Promise<Object>} Save result
 */
export async function saveKYC(handle, data) {
    const res = await fetch(`${API_BASE}/api/kyc`, {
        method: 'POST',
        headers: buildSecurityHeaders(),
        body: JSON.stringify(withApproval({ handle, ...data }, 'ui-save-kyc'))
    });
    if (!res.ok) throw new Error(`Failed to save KYC: ${res.statusText}`);
    return await res.json();
}

/**
 * Trigger a sync for a specific source
 * @param {string} source - Source to sync ('imessage', 'whatsapp', 'notes')
 * @returns {Promise<Object>} Sync result
 */
export async function triggerSync(source) {
    const endpoint = `/api/sync-${source}`;
    const res = await fetch(endpoint, {
        method: 'POST',
        headers: buildSecurityHeaders(),
        body: JSON.stringify(withApproval({ source }, `ui-sync-${source}`)),
    });
    if (!res.ok) throw new Error(`Failed to trigger ${source} sync: ${res.statusText}`);
    return await res.json();
}

/**
 * Load UI settings (local-only)
 * @returns {Promise<Object>}
 */
export async function getSettings() {
    const res = await fetch(`${API_BASE}/api/settings`);
    if (res.status === 404) {
        throw new Error('Settings API not available (this server build is missing /api/settings).');
    }
    if (!res.ok) throw new Error(`Failed to load settings: ${res.status} ${res.statusText}`);
    return await res.json();
}

/**
 * Save UI settings (local-only)
 * @param {Object} data
 * @returns {Promise<Object>}
 */
export async function saveSettings(data) {
    const res = await fetch(`${API_BASE}/api/settings`, {
        method: 'POST',
        headers: buildSecurityHeaders(),
        body: JSON.stringify(withApproval(data || {}, 'ui-save-settings'))
    });
    if (res.status === 404) {
        throw new Error('Settings API not available (this server build is missing /api/settings).');
    }
    if (!res.ok) throw new Error(`Failed to save settings: ${res.status} ${res.statusText}`);
    return await res.json();
}

export async function getGmailAuthUrl() {
    const res = await fetch(`${API_BASE}/api/gmail/auth-url`);
    if (res.status === 404) throw new Error('Gmail API not available (restart the server).');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `Failed to start Gmail auth: ${res.status} ${res.statusText}`);
    return data;
}

export async function disconnectGmail() {
    const res = await fetch(`${API_BASE}/api/gmail/disconnect`, {
        method: 'POST',
        headers: buildSecurityHeaders(),
        body: JSON.stringify(withApproval({}, 'ui-disconnect-gmail')),
    });
    if (res.status === 404) throw new Error('Gmail API not available (restart the server).');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `Failed to disconnect Gmail: ${res.status} ${res.statusText}`);
    return data;
}
