#!/usr/bin/env node
/**
 * Lightweight “unified brain” status line for operators (reply#12).
 * Prints JSON: style profile presence + LanceDB path. Safe to run in CI or locally.
 */
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
require("dotenv").config({ path: path.join(__dirname, ".env.local"), override: true });

const STYLE = path.join(__dirname, "..", "knowledge", "style-profile.json");
const lancedbUri = process.env.REPLY_LANCEDB_URI || path.join(__dirname, "..", "knowledge", "lancedb");

function main() {
    let styleProfile = false;
    try {
        styleProfile = fs.existsSync(STYLE) && fs.statSync(STYLE).size > 2;
    } catch {
        styleProfile = false;
    }
    const out = {
        styleProfile,
        lancedbUri,
        note: "Extend this report as calendar + mail scale-out land; see docs/UNIFIED_BRAIN.md"
    };
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
}

main();
