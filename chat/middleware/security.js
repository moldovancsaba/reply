/**
 * {reply} - Security Middleware
 * Handles CORS, CSP, Rate Limiting, and Authentication
 */

const {
    resolveClientIp,
    appendSecurityAudit,
    hasValidOperatorToken,
    isHumanApproved,
    isLocalRequest
} = require("../security-policy");
const { createRateLimiter } = require("../rate-limiter");
const { writeJson } = require("../utils/server-utils");

const OPERATOR_TOKEN_COOKIE_NAME = "reply_operator_token";

const sensitiveRateLimiter = createRateLimiter({ windowMs: 60000, maxRequests: 30 });

const RATE_LIMITED_ROUTES = new Set([
    "/api/send-imessage",
    "/api/send-whatsapp",
    "/api/send-linkedin",
    "/api/send-email",
    "/api/sync-imessage",
    "/api/sync-whatsapp",
    "/api/sync-mail",
    "/api/sync-notes",
    "/api/settings",
    "/api/kyc",
    "/api/gmail/disconnect",
    "/api/analyze-contact",
    "/api/channel-bridge/inbound",
]);

const CSP_HEADER = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://cdnjs.cloudflare.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob: https://www.gravatar.com",
    "font-src 'self' https://fonts.gstatic.com",
    "connect-src 'self' ws: wss:",
    "media-src 'self' blob:",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
].join("; ");

function auditSecurityDecision(req, params) {
    appendSecurityAudit({
        route: params.route,
        action: params.action,
        method: req.method,
        decision: params.decision,
        reason: params.reason || "",
        dryRun: Boolean(params.dryRun),
        ip: resolveClientIp(req),
        userAgent: String(req.headers["user-agent"] || ""),
    });
}

function denySensitiveRoute(req, res, params) {
    auditSecurityDecision(req, {
        route: params.route,
        action: params.action,
        decision: "deny",
        reason: params.code,
        dryRun: params.dryRun,
    });
    writeJson(res, params.statusCode || 403, {
        error: params.message,
        code: params.code,
        hint: params.hint,
    });
}

function authorizeSensitiveRoute(req, res, securityPolicy, options) {
    const route = options.route || "unknown";
    const action = options.action || route;
    const payload = options.payload || {};
    const requireHumanApproval = options.requireHumanApproval !== false;
    const dryRun = Boolean(payload?.dryRun);

    if (securityPolicy.localWritesOnly && !isLocalRequest(req)) {
        denySensitiveRoute(req, res, {
            route,
            action,
            code: "local_only",
            message: "Sensitive route is restricted to local requests.",
            hint: "Use localhost access or disable REPLY_SECURITY_LOCAL_WRITES_ONLY (not recommended).",
            statusCode: 403,
            dryRun,
        });
        return false;
    }

    if (securityPolicy.requireOperatorToken && !hasValidOperatorToken(req, securityPolicy)) {
        denySensitiveRoute(req, res, {
            route,
            action,
            code: "operator_token_required",
            message: "Missing or invalid operator token.",
            hint: "Provide X-Reply-Operator-Token with a valid token.",
            statusCode: 401,
            dryRun,
        });
        return false;
    }

    const approvalRequired =
        securityPolicy.requireHumanApproval &&
        requireHumanApproval &&
        !(dryRun && securityPolicy.allowDryRunWithoutApproval);
    if (approvalRequired && !isHumanApproved(req, payload)) {
        denySensitiveRoute(req, res, {
            route,
            action,
            code: "human_approval_required",
            message: "Human approval is required for this sensitive action.",
            hint: "Send approval.confirmed=true in payload or X-Reply-Human-Approval: confirmed.",
            statusCode: 403,
            dryRun,
        });
        return false;
    }

    auditSecurityDecision(req, {
        route,
        action,
        decision: "allow",
        reason: "authorized",
        dryRun,
    });
    return true;
}

function handleSecurity(req, res, boundPort, securityPolicy) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;
    const origin = req.headers.origin || "";

    const ALLOWED_CORS_ORIGINS = new Set([
        `http://localhost:${boundPort}`,
        `http://127.0.0.1:${boundPort}`,
        "https://www.linkedin.com",
        "https://linkedin.com",
        "https://web.whatsapp.com"
    ]);

    const allowedOrigin = ALLOWED_CORS_ORIGINS.has(origin) ? origin : `http://localhost:${boundPort}`;

    if (origin && !ALLOWED_CORS_ORIGINS.has(origin)) {
        writeJson(res, 403, { error: "CORS: origin not allowed" });
        return false;
    }

    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Reply-Operator-Token, X-Reply-Human-Approval");
    res.setHeader("Access-Control-Max-Age", "86400");

    if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return false;
    }

    res.setHeader("Content-Security-Policy", CSP_HEADER);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");

    // Operator Token Cookie
    if (securityPolicy.requireOperatorToken && isLocalRequest(req)) {
        try {
            const token = String(securityPolicy.operatorToken || "").trim();
            if (token) {
                const cookie = [
                    `${OPERATOR_TOKEN_COOKIE_NAME}=${encodeURIComponent(token)}`,
                    "Path=/",
                    "HttpOnly",
                    "SameSite=Strict",
                    "Max-Age=43200",
                ].join("; ");
                res.setHeader("Set-Cookie", cookie);
            }
        } catch (e) {
            console.error("Error setting operator token cookie:", e.message);
        }
    }

    // Rate Limiting
    if (RATE_LIMITED_ROUTES.has(pathname) && req.method === "POST") {
        const clientIp = resolveClientIp(req);
        if (!sensitiveRateLimiter.isAllowed(clientIp)) {
            const status = sensitiveRateLimiter.getStatus(clientIp);
            res.writeHead(429, {
                "Content-Type": "application/json",
                "Retry-After": String(Math.ceil(status.resetMs / 1000)),
            });
            res.end(JSON.stringify({ error: "Too many requests. Please try again later." }));
            return false;
        }
    }

    return true;
}

module.exports = {
    handleSecurity,
    authorizeSensitiveRoute,
    denySensitiveRoute,
    auditSecurityDecision
};
