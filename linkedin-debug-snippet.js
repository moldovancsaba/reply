
// Paste this into the Chrome Developer Console (F12 -> Console) on your LinkedIn Messaging tab
(function () {
    console.log("--- Reply Brain LinkedIn Debugger ---");

    const threadEl = document.querySelector(".msg-s-message-list-content");
    console.log("1. Thread Container (.msg-s-message-list-content):", threadEl ? "✅ FOUND" : "❌ NOT FOUND");

    if (threadEl) {
        const msgElements = threadEl.querySelectorAll(".msg-s-event-listitem");
        console.log(`2. Message Elements (.msg-s-event-listitem): ${msgElements.length} found`);

        if (msgElements.length > 0) {
            const first = msgElements[0];
            const content = first.querySelector(".msg-s-event__content");
            const sender = first.querySelector(".msg-s-message-group__name");
            console.log("   - First Message Content:", content ? "✅ FOUND" : "❌ NOT FOUND");
            console.log("   - First Message Sender:", sender ? "✅ FOUND" : "❌ NOT FOUND");
            if (content) console.log("   - Sample Text:", content.innerText.slice(0, 20) + "...");
        }
    }

    const headerEl = document.querySelector(".msg-entity-lockup__entity-title");
    console.log("3. Partner Name (.msg-entity-lockup__entity-title):", headerEl ? `✅ FOUND ("${headerEl.innerText.trim()}")` : "❌ NOT FOUND");

    console.log("-------------------------------------");
    if (!threadEl || !headerEl) {
        console.warn("⚠️  Selectors seem broken. LinkedIn might have changed the layout.");
    } else {
        console.log("✅ Selectors look good. If sync fails, check Network tab for failures to localhost:3000.");
    }
})();
