/**
 * {reply} - API Layer
 * Handles all HTTP requests to the backend server
 */

const API_BASE = '';

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

/**
 * Send a message to a contact
 * @param {string} handle - Contact handle
 * @param {string} text - Message text
 * @param {('imessage'|'email'|'whatsapp')} channel - Channel to use
 * @returns {Promise<Object>} Send result
 */
export async function sendMessage(handle, text, channel = 'imessage') {
    const ch = (channel || 'imessage').toString().toLowerCase();
    const endpoint = ch === 'email' ? '/api/send-email' : (ch === 'whatsapp' ? '/api/send-whatsapp' : '/api/send-imessage');
    const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: handle, text })
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle, ...data })
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
    const res = await fetch(endpoint, { method: 'POST' });
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data || {})
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
    const res = await fetch(`${API_BASE}/api/gmail/disconnect`, { method: 'POST' });
    if (res.status === 404) throw new Error('Gmail API not available (restart the server).');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `Failed to disconnect Gmail: ${res.status} ${res.statusText}`);
    return data;
}
