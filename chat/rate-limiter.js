/**
 * Simple in-memory rate limiter for sensitive routes.
 * Uses a sliding window counter per IP address.
 * No external dependencies.
 */

const DEFAULT_WINDOW_MS = 60 * 1000; // 1 minute
const DEFAULT_MAX_REQUESTS = 30;     // 30 requests per window for sensitive routes

/**
 * @param {object} options
 * @param {number} [options.windowMs=60000] - Window size in milliseconds
 * @param {number} [options.maxRequests=30] - Max requests per window per IP
 * @returns {{ isAllowed: (ip: string) => boolean, reset: () => void }}
 */
function createRateLimiter(options = {}) {
    const windowMs = options.windowMs || DEFAULT_WINDOW_MS;
    const maxRequests = options.maxRequests || DEFAULT_MAX_REQUESTS;

    // Map<ip, { count, windowStart }>
    const counters = new Map();

    // Periodic cleanup to prevent memory leaks (every 5 minutes)
    const cleanupInterval = setInterval(() => {
        const now = Date.now();
        for (const [ip, entry] of counters) {
            if (now - entry.windowStart > windowMs * 2) {
                counters.delete(ip);
            }
        }
    }, 5 * 60 * 1000);

    // Allow cleanup interval to not keep the process alive
    if (cleanupInterval.unref) cleanupInterval.unref();

    /**
     * Check if a request from the given IP is allowed.
     * @param {string} ip
     * @returns {boolean}
     */
    function isAllowed(ip) {
        const now = Date.now();
        const key = String(ip || "unknown");
        let entry = counters.get(key);

        if (!entry || now - entry.windowStart > windowMs) {
            entry = { count: 1, windowStart: now };
            counters.set(key, entry);
            return true;
        }

        entry.count += 1;
        return entry.count <= maxRequests;
    }

    /**
     * Get remaining requests for an IP in the current window.
     * @param {string} ip
     * @returns {{ remaining: number, resetMs: number }}
     */
    function getStatus(ip) {
        const now = Date.now();
        const key = String(ip || "unknown");
        const entry = counters.get(key);

        if (!entry || now - entry.windowStart > windowMs) {
            return { remaining: maxRequests, resetMs: windowMs };
        }

        return {
            remaining: Math.max(0, maxRequests - entry.count),
            resetMs: Math.max(0, windowMs - (now - entry.windowStart)),
        };
    }

    function reset() {
        counters.clear();
    }

    return { isAllowed, getStatus, reset, maxRequests, windowMs };
}

module.exports = { createRateLimiter };
