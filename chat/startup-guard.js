"use strict";

const hubRuntime = require("./hub-runtime");

function getLaunchState() {
    return hubRuntime.getBootstrapState();
}

function isLaunchReady(launch = getLaunchState()) {
    return launch?.ready === true;
}

function buildStartupBlockMessage({ noun = "Operation" } = {}) {
    const launch = getLaunchState();
    if (isLaunchReady(launch)) return null;
    const stage = String(launch?.stage || "initializing").trim() || "initializing";
    const detail = String(launch?.message || "Local runtime startup is still in progress.").trim();
    return {
        status: "error",
        code: "startup_in_progress",
        message: `${String(noun || "Operation")} unavailable during startup (${stage}). ${detail}`
    };
}

module.exports = {
    getLaunchState,
    isLaunchReady,
    buildStartupBlockMessage,
};
