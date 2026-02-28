const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * {hatori} Client for local intelligence, annotation and drafting.
 * Base URL: http://127.0.0.1:23572
 */

let _token = null;

function loadHatoriToken() {
    if (_token) return _token;

    // 1. Try environment variable
    if (process.env.HATORI_API_TOKEN) {
        _token = process.env.HATORI_API_TOKEN;
        return _token;
    }

    // 2. Try ~/.config/hatori/hatori.env
    try {
        const envPath = path.join(os.homedir(), '.config', 'hatori', 'hatori.env');
        if (fs.existsSync(envPath)) {
            const content = fs.readFileSync(envPath, 'utf8');
            const match = content.match(/^HATORI_API_TOKEN=(.*)$/m);
            if (match && match[1]) {
                _token = match[1].trim();
                return _token;
            }
        }
    } catch (e) {
        // Ignore errors reading local config
    }

    return null;
}

const HATORI_API_URL = process.env.HATORI_API_URL || 'http://127.0.0.1:23572';

async function request(path, method = 'GET', body = null) {
    const token = loadHatoriToken();
    const url = new URL(path, HATORI_API_URL);
    const options = {
        method,
        headers: {
            'Content-Type': 'application/json',
            'X-Hatori-Token': token
        }
    };

    return new Promise((resolve, reject) => {
        const req = http.request(url, options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 400) {
                    return reject(new Error(`Hatori API error: ${res.statusCode} ${data}`));
                }
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    resolve(data);
                }
            });
        });

        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

/**
 * Check Hatori health and model status.
 */
async function getHealth() {
    return request('/v1/health');
}

/**
 * Ingest an event (message, document, etc.) into Hatori.
 * @param {object} params - { external_event_id, kind, conversation_id, sender_id, content, metadata }
 */
async function ingestEvent(params) {
    return request('/v1/ingest/event', 'POST', params);
}

/**
 * Request a reply suggestion or full orchestration from Hatori.
 * @param {object} params - { conversation_id, message_id, sender_id, message, metadata, mode }
 */
async function getResponse(params) {
    return request('/v1/agent/respond', 'POST', {
        mode: 'chat',
        ...params
    });
}

/**
 * Specifically request "Next Best Actions" (NBA) for a conversation state.
 * This is a wrapper around getResponse with orchestration defaults.
 */
async function getNBA(params) {
    const res = await getResponse({
        ...params,
        mode: 'orchestration'
    });

    // Sort next_actions by priority (P0 -> P1 -> P2 -> default)
    if (res && Array.isArray(res.next_actions)) {
        res.next_actions.sort((a, b) => {
            const prio = (val) => {
                const s = String(val || '').toUpperCase();
                if (s.includes('P0')) return 0;
                if (s.includes('P1')) return 1;
                if (s.includes('P2')) return 2;
                return 10;
            };
            return prio(a) - prio(b);
        });
    }
    return res;
}

/**
 * Report the outcome of a suggestion to Hatori.
 * @param {object} params - { external_outcome_id, assistant_interaction_id, status, original_text, final_sent_text, diff }
 */
async function reportOutcome(params) {
    return request('/v1/agent/outcome', 'POST', params);
}

module.exports = {
    getHealth,
    ingestEvent,
    getResponse,
    getNBA,
    reportOutcome
};
