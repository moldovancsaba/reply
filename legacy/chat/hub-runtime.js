/**
 * In-process hub listen address and bootstrap state (set from `server.js`).
 * Exposed on `/api/health` so native launch can wait for actual readiness.
 */

let httpPort = null;
let httpHost = "127.0.0.1";
let bootstrapState = {
    stage: "initializing",
    ready: false,
    startedAt: new Date().toISOString(),
    readyAt: null,
    message: "Initializing hub..."
};

function setListenInfo(port, host) {
    httpPort = typeof port === "number" && Number.isFinite(port) ? port : null;
    if (host) httpHost = String(host);
}

function getListenInfo() {
    return { httpPort, httpHost };
}

function resetBootstrap(stage = "initializing", message = "Initializing hub...") {
    bootstrapState = {
        stage: String(stage || "initializing"),
        ready: false,
        startedAt: new Date().toISOString(),
        readyAt: null,
        message: String(message || "Initializing hub...")
    };
}

function setBootstrapStage(stage, message = "") {
    bootstrapState = {
        ...bootstrapState,
        stage: String(stage || bootstrapState.stage || "initializing"),
        ready: false,
        message: String(message || bootstrapState.message || "")
    };
}

function markBootstrapReady(message = "Hub ready.") {
    bootstrapState = {
        ...bootstrapState,
        stage: "ready",
        ready: true,
        readyAt: new Date().toISOString(),
        message: String(message || "Hub ready.")
    };
}

function markBootstrapError(message = "Hub startup failed.") {
    bootstrapState = {
        ...bootstrapState,
        stage: "error",
        ready: false,
        message: String(message || "Hub startup failed.")
    };
}

function getBootstrapState() {
    return { ...bootstrapState };
}

module.exports = {
    setListenInfo,
    getListenInfo,
    resetBootstrap,
    setBootstrapStage,
    markBootstrapReady,
    markBootstrapError,
    getBootstrapState
};
