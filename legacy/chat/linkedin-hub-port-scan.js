/**
 * LinkedIn bridge → local hub port discovery (reply#30).
 * Default `{reply}` listens on 45311+; legacy dev used 3000–3003. Probe both.
 *
 * **Browser copies:** `chrome-extension/content.js` and `js/linkedin-bridge.user.js`
 * duplicate this algorithm (no bundler); keep lists identical when changing.
 */
"use strict";

const DEFAULT_HUB_FIRST_PORT = 45311;
const DEFAULT_HUB_LAST_PORT = 45326;
const LEGACY_DEV_PORTS = [3000, 3001, 3002, 3003];

function buildLinkedInHubPortScanList() {
  const out = [];
  for (let p = DEFAULT_HUB_FIRST_PORT; p <= DEFAULT_HUB_LAST_PORT; p++) {
    out.push(p);
  }
  out.push(...LEGACY_DEV_PORTS);
  return out;
}

module.exports = {
  buildLinkedInHubPortScanList,
  DEFAULT_HUB_FIRST_PORT,
  DEFAULT_HUB_LAST_PORT,
  LEGACY_DEV_PORTS,
};
