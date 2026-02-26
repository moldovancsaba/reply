/**
 * {reply} - Server Utilities
 * Common helpers for request/response handling
 */

function writeJson(res, statusCode, payload) {
    res.writeHead(statusCode, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
}

function readRequestBody(req) {
    return new Promise((resolve, reject) => {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => resolve(body));
        req.on("error", reject);
    });
}

async function readJsonBody(req) {
    const body = await readRequestBody(req);
    if (!body) return {};
    try {
        return JSON.parse(body);
    } catch {
        return {};
    }
}

function parseJsonSafe(raw) {
    const text = String(raw || "").trim();
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

function normalizeErrorText(raw, fallback = "") {
    let text = String(raw || "").trim();
    while (/^error:\s*/i.test(text)) {
        text = text.replace(/^error:\s*/i, "").trim();
    }
    text = text.replace(/\s+/g, " ").trim();
    return text || fallback;
}

module.exports = {
    writeJson,
    readRequestBody,
    readJsonBody,
    parseJsonSafe,
    normalizeErrorText
};
