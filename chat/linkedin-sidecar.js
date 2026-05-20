/**
 * {reply} - LinkedIn Sidecar Scraper
 * A robust background scraper for LinkedIn messages.
 */

const { chromium } = require('playwright');
const { normalizeLinkedInHandle } = require('./linkedin-utils.js');
const { dataPath, ensureDataHome } = require('./app-paths.js');
const { buildLinkedInHubPortScanList } = require('./linkedin-hub-port-scan.js');

const POLL_INTERVAL = 30000; // 30 seconds
const SEEN_IDS = new Set();
const BRIDGE_ENDPOINT = "/api/channel-bridge/inbound";
const HEALTH_ENDPOINT = "/api/health";
let activeHubBaseUrl = null;

async function resolveHubBaseUrl() {
    const explicit = String(process.env.REPLY_BRIDGE_ENDPOINT || "").trim();
    if (explicit) {
        return explicit.replace(/\/api\/channel-bridge\/inbound\/?$/i, "").replace(/\/$/, "");
    }

    if (activeHubBaseUrl) return activeHubBaseUrl;
    for (const port of buildLinkedInHubPortScanList()) {
        const baseUrl = `http://localhost:${port}`;
        try {
            const response = await fetch(`${baseUrl}${HEALTH_ENDPOINT}`);
            if (response.ok) {
                activeHubBaseUrl = baseUrl;
                return baseUrl;
            }
        } catch {
            // keep scanning
        }
    }
    throw new Error("Local {reply} hub is not reachable on the LinkedIn bridge port set.");
}

async function runSidecar() {
    console.log("🚀 Starting LinkedIn Sidecar Scraper...");

    // Setup state directory for persistent session
    ensureDataHome();
    const userDataDir = dataPath('linkedin-session');

    const browser = await chromium.launchPersistentContext(userDataDir, {
        headless: false, // Set to true for background operation
        viewport: { width: 1280, height: 720 }
    });

    const page = await browser.newPage();

    async function scrape() {
        try {
            console.log("🔍 Checking LinkedIn messages...");
            await page.goto('https://www.linkedin.com/messaging/', { waitUntil: 'networkidle' });

            // 1. Wait for message list
            const threadSelector = ".msg-s-message-list-content, .msg-s-message-list";
            await page.waitForSelector(threadSelector, { timeout: 10000 });

            // 2. Identify active partner
            const partnerName = await page.$eval('.msg-entity-lockup__entity-title, .msg-thread__title', el => el.innerText.trim());
            const partnerHandle = normalizeLinkedInHandle(partnerName);

            if (!partnerHandle) {
                console.warn("⚠️ Could not resolve partner handle.");
                return;
            }

            // 3. Scrape messages
            const messages = await page.$$eval('.msg-s-event-listitem', (elements, handle) => {
                return elements.map(el => {
                    const msgId = el.getAttribute("data-urn") || el.getAttribute("id");
                    const contentEl = el.querySelector(".msg-s-event__content, .msg-s-event-listitem__body");
                    const senderEl = el.querySelector(".msg-s-message-group__name, .msg-s-event-listitem__name");
                    const timeEl = el.querySelector("time");

                    if (!contentEl) return null;

                    const text = contentEl.innerText.trim();
                    const senderName = senderEl ? senderEl.innerText.trim() : "Unknown";
                    const isMine = el.classList.contains("msg-s-message-group--is-mine") ||
                        senderName.toLowerCase() === "you" ||
                        senderName.toLowerCase() === "me";

                    return {
                        channel: "linkedin",
                        peer: handle,
                        text: isMine ? `(You): ${text}` : text,
                        messageId: msgId || `li-${handle}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                        timestamp: new Date().toISOString()
                    };
                }).filter(Boolean);
            }, partnerHandle);

            // 4. Filter duplicates and send to bridge
            const newEvents = messages.filter(m => !SEEN_IDS.has(m.messageId));
            if (newEvents.length > 0) {
                console.log(`✅ Found ${newEvents.length} new messages for ${partnerName}`);
                const hubBaseUrl = await resolveHubBaseUrl();

                const response = await fetch(`${hubBaseUrl}${BRIDGE_ENDPOINT}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ events: newEvents })
                });

                if (response.ok) {
                    newEvents.forEach(m => SEEN_IDS.add(m.messageId));
                    console.log("📤 Synced successfully.");
                } else {
                    console.error("❌ Bridge sync failed:", response.status);
                    activeHubBaseUrl = null;
                }
            } else {
                console.log("No new messages.");
            }

        } catch (err) {
            console.error("⚠️ Scrape error:", err.message);
            if (err.message.includes("Target page, context or browser has been closed")) {
                process.exit(0);
            }
        }
    }

    // Initial run
    await scrape();

    // Polling loop
    setInterval(scrape, POLL_INTERVAL);
}

if (require.main === module) {
    runSidecar().catch(err => {
        console.error("Fatal sidecar error:", err);
        process.exit(1);
    });
}

module.exports = { runSidecar };
