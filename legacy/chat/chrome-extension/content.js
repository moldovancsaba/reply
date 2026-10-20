// {reply} brain - LinkedIn Bridge Content Script (reply#30)
// Port list MUST stay in sync with `chat/linkedin-hub-port-scan.js` and `js/linkedin-bridge.user.js`.

function buildLinkedInHubPortScanList() {
    const out = [];
    for (let p = 45311; p <= 45326; p++) out.push(p);
    out.push(3000, 3001, 3002, 3003);
    return out;
}

const PORTS = buildLinkedInHubPortScanList();
const ENDPOINT = "/api/channel-bridge/inbound";
let activePort = null;
let isConnected = false;
const SEEN_IDS = new Set();
const POLL_INTERVAL = 5000;

// Toast Helper
function showToast(msg, isError = false) {
    let toast = document.getElementById('reply-brain-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'reply-brain-toast';
        toast.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: ${isError ? '#d32f2f' : '#2e7d32'};
            color: white;
            padding: 10px 20px;
            border-radius: 4px;
            z-index: 9999;
            font-family: sans-serif;
            font-size: 14px;
            box-shadow: 0 2px 5px rgba(0,0,0,0.2);
            transition: opacity 0.5s;
        `;
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.background = isError ? '#d32f2f' : '#2e7d32';
    toast.style.opacity = '1';
    setTimeout(() => { toast.style.opacity = '0'; }, 3000);
}

// Sync Logic
async function sendToLocal(payload) {
    // If we don't have a stable port, try to find one during this send
    let portsToTry = activePort ? [activePort] : PORTS;

    // If we have an active port, try it first. If it fails, try others.
    if (activePort) {
        // exclude activePort from the rest list
        const others = PORTS.filter(p => p !== activePort);
        portsToTry = [activePort, ...others];
    }

    let success = false;

    for (const port of portsToTry) {
        const url = `http://localhost:${port}${ENDPOINT}`;
        try {
            const res = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                activePort = port; // Confirmed working
                if (!isConnected) {
                    isConnected = true;
                    showToast(`{reply} brain: Connected (Port ${port})`);
                }
                console.log(`✅ Synced to :${port}`, payload.events.length, "messages");
                success = true;
                break; // Stop trying ports
            } else {
                console.warn(`⚠️ Sync failed on :${port}`, res.status);
            }
        } catch (e) {
            // Connection refused or other network error
            console.debug(`❌ Port ${port} unreachable`);
            if (port === activePort) activePort = null; // Reset if our main one died
        }
    }

    if (!success) {
        isConnected = false;
        const label =
            PORTS.length <= 10
                ? PORTS.join(", ")
                : `${PORTS.slice(0, 4).join(", ")} … ${PORTS.slice(-4).join(", ")} (${PORTS.length} ports)`;
        console.error("❌ {reply} hub unreachable on any scanned port:", label);
        showToast(`{reply}: hub not found (tried ${label}). Start {reply} or check PORT.`, true);
    }
}

// Normalization Utility (mirrors backend linkedin-utils.js)
function normalizeLinkedInHandle(input) {
    if (!input) return "";
    let clean = String(input)
        .replace(/^(imessage:\/\/|whatsapp:\/\/|mailto:|telegram:\/\/|discord:\/\/|signal:\/\/|viber:\/\/|linkedin:\/\/|messenger:\/\/|instagram:\/\/|sms:\/\/)/i, "")
        .trim();
    if (clean.includes("linkedin.com/in/")) {
        clean = clean.split("linkedin.com/in/")[1].split("/")[0].split("?")[0];
    }
    const normalized = clean
        .toLowerCase()
        .replace(/\s+/g, "")
        .replace(/[^\w-]/g, "");
    return normalized ? `linkedin://${normalized}` : "";
}

function scrapeVisibleMessages() {
    // Current LinkedIn messaging list container
    const threadEl = document.querySelector(".msg-s-message-list-content") ||
        document.querySelector(".msg-s-message-list");
    if (!threadEl) return null;

    // Active conversation partner
    const headerEl = document.querySelector(".msg-entity-lockup__entity-title") ||
        document.querySelector(".msg-thread__title");
    const partnerName = headerEl ? headerEl.innerText.trim() : "Unknown LinkedIn User";

    // Use unified handle normalization
    const partnerHandle = normalizeLinkedInHandle(partnerName);
    if (!partnerHandle) return null;

    const messages = [];
    const msgElements = threadEl.querySelectorAll(".msg-s-event-listitem");

    msgElements.forEach(el => {
        let msgId = el.getAttribute("data-urn") || el.getAttribute("id");
        const contentEl = el.querySelector(".msg-s-event__content") || el.querySelector(".msg-s-event-listitem__body");
        if (!contentEl) return;

        const senderEl = el.querySelector(".msg-s-message-group__name") || el.querySelector(".msg-s-event-listitem__name");
        const senderName = senderEl ? senderEl.innerText.trim() : "Unknown";
        const text = contentEl.innerText.trim();

        const isMine = el.classList.contains("msg-s-message-group--is-mine") ||
            senderName.toLowerCase() === "you" ||
            senderName.toLowerCase() === "me";

        const timeEl = el.querySelector("time");
        const timeText = timeEl ? timeEl.innerText.trim() : "";

        if (!msgId) {
            // Fallback stable ID
            msgId = `li-${partnerHandle}-${timeText}-${text.substring(0, 30)}`.replace(/[^a-zA-Z0-9]/g, '-');
        }

        if (SEEN_IDS.has(msgId)) return;

        messages.push({
            channel: "linkedin",
            peer: partnerHandle,
            text: isMine ? `(You): ${text}` : text,
            messageId: msgId,
            timestamp: new Date().toISOString()
        });

        SEEN_IDS.add(msgId);
    });

    return messages;
}

// Start Polling
console.log("🚀 {reply} brain extension active (multi-port)");
showToast("{reply} brain: extension active", false);

setInterval(() => {
    const events = scrapeVisibleMessages();
    if (events && events.length > 0) {
        sendToLocal({ events: events });
        showToast(`Synced ${events.length} new messages`);
    }
}, POLL_INTERVAL);
