/**
 * Reply Hub - API Layer
 * Handles all HTTP requests to the backend server
 */

const API_BASE = '';

/**
 * Fetch paginated list of conversations/contacts
 * @param {number} offset - Starting index for pagination
 * @param {number} limit - Number of contacts to fetch
 * @returns {Promise<{contacts: Array, hasMore: boolean, total: number}>}
 */
export async function fetchConversations(offset = 0, limit = 20) {
    const res = await fetch(`${API_BASE}/api/conversations?offset=${offset}&limit=${limit}`);
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
 * @param {boolean} isEmail - Whether this is an email
 * @returns {Promise<Object>} Send result
 */
export async function sendMessage(handle, text, isEmail = false) {
    const endpoint = isEmail ? '/api/send-email' : '/api/send-imessage';
    const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: handle, text })
    });
    if (!res.ok) throw new Error(`Failed to send message: ${res.statusText}`);
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
