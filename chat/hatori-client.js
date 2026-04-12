const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * {hatori} Client for local intelligence, annotation and drafting.
 * Base URL: http://127.0.0.1:23572
 *
 * ## Sensitivity contract (reply#16)
 * **`metadata.sensitivity`** (`SensitivityMeta`) is merged on `ingestEvent` / `getResponse` unless the caller already set it.
 * See `docs/HATORI_SENSITIVITY_CONTRACT.md`.
 *
 * @typedef {object} SensitivityMeta
 * @property {'raw'|'redacted'|'display_safe'} [payload_class] - Trust level of associated text
 * @property {string[]} [pii_classes] - Hint types present before redaction (e.g. email, phone)
 * @property {boolean} [safe_to_index] - If false, must not be embedded in LanceDB / RAG
 * @property {boolean} [channel_scoped_ids] - If true, do not correlate IDs across channels
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

function getHatoriApiBase() {
    const u = String(process.env.HATORI_API_URL || "http://127.0.0.1:23572").trim() || "http://127.0.0.1:23572";
    return u.replace(/\/$/, "");
}

/**
 * Default cross-system sensitivity hints (reply#16 Phase B — carried in `metadata.sensitivity`).
 * @param {string} [kind]
 * @param {object} [overrides]
 * @returns {SensitivityMeta}
 */
function defaultSensitivityMeta(kind, overrides = {}) {
  const o = overrides && typeof overrides === 'object' ? overrides : {};
  return {
    payload_class: o.payload_class || 'raw',
    pii_classes: Array.isArray(o.pii_classes) ? o.pii_classes : [],
    safe_to_index: o.safe_to_index !== false,
    channel_scoped_ids: o.channel_scoped_ids !== false,
  };
}

function mergeMetadataSensitivity(metadata, kind) {
  const meta = metadata && typeof metadata === 'object' ? { ...metadata } : {};
  const existing = meta.sensitivity && typeof meta.sensitivity === 'object' ? meta.sensitivity : {};
  meta.sensitivity = { ...defaultSensitivityMeta(kind), ...existing };
  return meta;
}

async function request(path, method = 'GET', body = null) {
    const token = loadHatoriToken();
    const url = new URL(path, `${getHatoriApiBase()}/`);
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
    const kind = params.kind || 'other';
    const metadata = mergeMetadataSensitivity(params.metadata, kind);
    return request('/v1/ingest/event', 'POST', { ...params, metadata });
}

/**
 * Request a reply suggestion or full orchestration from Hatori.
 * @param {object} params - { conversation_id, message_id, sender_id, message, metadata, mode }
 */
async function getResponse(params) {
    const hintKind = params.metadata?.channel || params.kind || 'chat';
    const metadata = mergeMetadataSensitivity(params.metadata, hintKind);
    return request('/v1/agent/respond', 'POST', {
        mode: 'chat',
        ...params,
        metadata,
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
    reportOutcome,
    defaultSensitivityMeta,
    mergeMetadataSensitivity,
};
