// Connector error codes (see docs/CORE_CONNECTORS.md). `blocked` codes need the operator to act and are never retried
// automatically; `retryable` codes get bounded backoff inside a run; everything else fails the run (state `error`).
export const BLOCKED = new Set(["permission_denied", "source_missing", "schema_unsupported", "helper_unavailable", "auth_failed"]);
export const RETRYABLE = new Set(["source_locked", "network_unavailable", "timeout"]);
export const CODES = new Set([...BLOCKED, ...RETRYABLE, "internal"]);

export class ConnectorError extends Error {
    constructor(code, message, { hint } = {}) {
        super(message);
        this.name = "ConnectorError";
        this.code = CODES.has(code) ? code : "internal";
        this.hint = hint;
    }
    get retryable() {
        return RETRYABLE.has(this.code);
    }
}

// Accepts ConnectorError, HelperError (same codes) or anything else (-> internal).
export function classify(err) {
    const code = CODES.has(err?.code) ? err.code : "internal";
    const kind = BLOCKED.has(code) ? "blocked" : RETRYABLE.has(code) ? "retryable" : "fatal";
    return { code, kind, hint: err?.hint, message: String(err?.message ?? err).slice(0, 300) };
}
