// Uniform error envelope used by every route. Messages never contain message text or personal data.
export class AppError extends Error {
    constructor(status, code, message, { retryable = false } = {}) {
        super(message);
        this.name = "AppError";
        this.status = status;
        this.code = code;
        this.retryable = retryable;
    }
}

export const forbidden = (code, message) => new AppError(403, code, message);

export function toEnvelope(err, requestId) {
    const status = err instanceof AppError ? err.status : statusOf(err);
    const known = err instanceof AppError;
    const code = known ? err.code : codeFor(status, err);
    const message = known ? err.message : messageFor(status);
    const retryable = known ? err.retryable : status >= 500;
    const details = known && err.details ? { details: err.details } : {};
    return { status, body: { error: { code, message, requestId, retryable, ...details } } };
}

function statusOf(err) {
    const s = Number(err?.statusCode ?? err?.status);
    return Number.isInteger(s) && s >= 400 && s < 600 ? s : 500;
}

function codeFor(status, err) {
    if (err?.validation || status === 400) return "invalid_request";
    if (status === 404) return "not_found";
    if (status === 413) return "payload_too_large";
    return "internal_error";
}

function messageFor(status) {
    if (status === 400) return "The request could not be understood.";
    if (status === 404) return "Not found.";
    if (status === 413) return "The request is too large.";
    return "Something went wrong. See the service log for the request id.";
}
