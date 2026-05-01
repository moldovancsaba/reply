/**
 * In-process hub listen address (set from `server.js` when the HTTP server binds).
 * Exposed on `/api/health` as `httpPort` / `httpHost` for runbook probes (reply#31).
 */

let httpPort = null;
let httpHost = "127.0.0.1";

function setListenInfo(port, host) {
    httpPort = typeof port === "number" && Number.isFinite(port) ? port : null;
    if (host) httpHost = String(host);
}

function getListenInfo() {
    return { httpPort, httpHost };
}

module.exports = { setListenInfo, getListenInfo };
