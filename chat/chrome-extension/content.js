// Reply Brain - LinkedIn Bridge Content Script

const PORTS = [3000, 3001, 3002, 3003];
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
                    showToast(`Reply Brain: Connected (Port ${port})`);
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
        console.error("❌ All ports failed to sync");
    }
}

function scrapeVisibleMessages() {
    const threadEl = document.querySelector(".msg-s-message-list-content");
    if (!threadEl) return null;

    const headerEl = document.querySelector(".msg-entity-lockup__entity-title");
    const partnerName = headerEl ? headerEl.innerText.trim() : "Unknown LinkedIn User";
    const partnerHandle = partnerName;

    const messages = [];
    const msgElements = threadEl.querySelectorAll(".msg-s-event-listitem");

    msgElements.forEach(el => {
        let msgId = el.getAttribute("data-urn") || el.getAttribute("id");
        const contentEl = el.querySelector(".msg-s-event__content");
        if (!contentEl) return;

        const senderEl = el.querySelector(".msg-s-message-group__name");
        const senderName = senderEl ? senderEl.innerText.trim() : "Unknown";
        const text = contentEl.innerText.trim();

        const isMine = el.classList.contains("msg-s-message-group--is-mine") ||
            senderName === "You" ||
            senderName === "Me";

        const timeEl = el.querySelector("time");
        const timeText = timeEl ? timeEl.innerText : "";

        if (!msgId) {
            msgId = `li-${partnerHandle}-${timeText}-${text.substring(0, 20)}`.replace(/\s+/g, '-');
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
console.log("🚀 Reply Brain Extension Active (Multi-port)");
showToast("Reply Brain: Extension Active", false);

setInterval(() => {
    const events = scrapeVisibleMessages();
    if (events && events.length > 0) {
        sendToLocal({ events: events });
        showToast(`Synced ${events.length} new messages`);
    }
}, POLL_INTERVAL);
