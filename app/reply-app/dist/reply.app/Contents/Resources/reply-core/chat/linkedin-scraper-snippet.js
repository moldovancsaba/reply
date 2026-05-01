
// LinkedIn Inbound Scraper Script
// Run this in the DevTools Console on https://www.linkedin.com/messaging/

(function () {
    const SERVER_URL = "http://localhost:3001/api/channel-bridge/inbound";
    const POLL_INTERVAL = 5000;
    const SEEN_IDS = new Set();

    console.log("🚀 LinkedIn Bridge Started. Pointing to " + SERVER_URL);

    async function sendToLocal(payload) {
        try {
            const res = await fetch(SERVER_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            if (res.ok) console.log("✅ Synced", payload.events.length, "messages");
            else console.error("❌ Sync failed:", res.status, await res.text());
        } catch (e) {
            console.error("❌ Network error:", e);
        }
    }

    function scrapeVisibleMessages() {
        const threadEl = document.querySelector(".msg-s-message-list-content");
        if (!threadEl) return null;

        // Extract active conversation partner
        const headerEl = document.querySelector(".msg-entity-lockup__entity-title");
        const partnerName = headerEl ? headerEl.innerText.trim() : "Unknown LinkedIn User";

        // Attempt to get a stable handle from the URL or UI
        // URL often looks like: /messaging/thread/2-YWR... or /messaging/thread/urn:li:fsd_profile:ACoAA...
        // The URN is better if available, but Partner Name is more human-readable for the initial contact creation.
        // We'll use Partner Name as the 'handle' for simplicity in this POC.
        const partnerHandle = partnerName;

        const messages = [];
        const msgElements = threadEl.querySelectorAll(".msg-s-event-listitem");

        msgElements.forEach(el => {
            // Try to find a stable ID
            // LinkedIn messages often have a data-event-urn or similar in the HTML, but scraping classes is fragile.
            // We will hash the content + timestamp-ish logic if no ID found, but let's look for attributes.
            // A common stable attribute in LinkedIn DOM is `data-urn`.
            let msgId = el.getAttribute("data-urn") || el.getAttribute("id");

            const contentEl = el.querySelector(".msg-s-event__content");
            if (!contentEl) return;

            const senderEl = el.querySelector(".msg-s-message-group__name");
            const senderName = senderEl ? senderEl.innerText.trim() : "Unknown";

            const text = contentEl.innerText.trim();

            // Determine if "Me"
            // LinkedIn sometimes puts "You" or the user's name.
            // We can also check class names. .msg-s-message-group--is-mine usually indicates sent by me.
            const isMine = el.classList.contains("msg-s-message-group--is-mine") ||
                senderName === "You" ||
                senderName === "Me";

            // Relative timestamp text (e.g. "10:00 AM")
            const timeEl = el.querySelector("time");
            const timeText = timeEl ? timeEl.innerText : "";

            // If we don't have a real ID, make one from text + time + sender
            if (!msgId) {
                msgId = `li-${partnerHandle}-${timeText}-${text.substring(0, 20)}`.replace(/\s+/g, '-');
            }

            if (SEEN_IDS.has(msgId)) return;

            // Adjust text for "Me" messages so they appear correctly in the vector store
            // which assumes "peer" is the speaker.
            const finalText = isMine ? `(You): ${text}` : text;

            messages.push({
                channel: "linkedin",
                peer: partnerHandle, // Always associate with the partner
                text: finalText,
                messageId: msgId,
                timestamp: new Date().toISOString() // We use 'now' for ingestion time effectively
            });

            SEEN_IDS.add(msgId);
        });

        return messages;
    }

    // Polling loop
    setInterval(() => {
        const events = scrapeVisibleMessages();
        if (events && events.length > 0) {
            sendToLocal({
                events: events
            });
        }
    }, POLL_INTERVAL);

})();
