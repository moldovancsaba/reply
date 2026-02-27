const http = require('http');

/**
 * {hatori} Client for local intelligence, annotation and drafting.
 * Base URL: http://127.0.0.1:23572
 */

const HATORI_API_URL = process.env.HATORI_API_URL || 'http://127.0.0.1:23572';

async function request(path, method = 'GET', body = null) {
    const token = process.env.HATORI_API_TOKEN;
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
 * Request a reply suggestion from Hatori.
 * @param {object} params - { conversation_id, message_id, sender_id, message, metadata }
 */
async function getResponse(params) {
    return request('/v1/agent/respond', 'POST', {
        ...params,
        mode: 'chat'
    });
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
    reportOutcome
};
