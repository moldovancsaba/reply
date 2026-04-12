// ==UserScript==
// @name         Reply Brain - LinkedIn Bridge
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  Syncs LinkedIn messages to local {reply} hub (scans 45311-45326 then legacy 3000-3003)
// @author       Reply Brain
// @match        https://www.linkedin.com/messaging/*
// @grant        GM_xmlhttpRequest
// @connect      localhost
// ==/UserScript==

(function () {
    'use strict';

    // MUST match chat/linkedin-hub-port-scan.js + chrome-extension/content.js (reply#30)
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

    // Toast notification helper
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

        setTimeout(() => {
            toast.style.opacity = '0';
        }, 3000);
    }

    console.log("🚀 Reply Brain: LinkedIn Bridge Active (Multi-port)");
    showToast("Reply Brain: Linked", false);

    async function sendToLocal(payload) {
        let portsToTry = activePort ? [activePort] : PORTS;

        if (activePort) {
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
                    activePort = port;
                    if (!isConnected) {
                        isConnected = true;
                        showToast(`Reply Brain: Connected (Port ${port})`);
                    }
                    console.log(`✅ Synced to :${port}`, payload.events.length, "messages");
                    success = true;
                    break;
                } else {
                    console.warn(`⚠️ Sync failed on :${port}`, res.status);
                }
            } catch (e) {
                console.debug(`❌ Port ${port} unreachable`);
                if (port === activePort) activePort = null;
            }
        }

        if (!success) {
            isConnected = false;
            const label =
                PORTS.length <= 10
                    ? PORTS.join(", ")
                    : `${PORTS.slice(0, 4).join(", ")} … ${PORTS.slice(-4).join(", ")} (${PORTS.length} ports)`;
            console.error("Reply hub unreachable (tried):", label);
            showToast(`Reply: hub not found (${label}). Start {reply} or check PORT.`, true);
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

            const finalText = isMine ? `(You): ${text}` : text;

            messages.push({
                channel: "linkedin",
                peer: partnerHandle,
                text: finalText,
                messageId: msgId,
                timestamp: new Date().toISOString()
            });

            SEEN_IDS.add(msgId);
        });

        return messages;
    }

    setInterval(() => {
        const events = scrapeVisibleMessages();
        if (events && events.length > 0) {
            sendToLocal({
                events: events
            });
            showToast(`Synced ${events.length} new messages`);
        }
    }, POLL_INTERVAL);

})();
