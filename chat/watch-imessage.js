const { exec } = require('child_process');
const { addDocuments } = require('./vector-store.js');

/**
 * Polls Messages app for recent messages.
 * Note: AppleScript can access the UI/Logic of Messages.app safely.
 */
function pollNewMessages() {
    const appleScript = `
        tell application "Messages"
            set recentMessages to {}
            set chatList to chats
            repeat with aChat in chatList
                set lastMsgs to (messages of aChat whose read is false) -- Only get unread for polling? 
                -- Actually let's just get the last 5 from all to be sure
                set lastMsgs to (items -5 thru -1 of messages of aChat)
                repeat with aMsg in lastMsgs
                    set msgData to {id: (id of aMsg) as string, content: (contents of aMsg) as string, sender: (handle of participant 1 of aChat) as string, date: (date of aMsg) as string, isFromMe: (from me of aMsg)}
                    copy msgData to end of recentMessages
                end repeat
            end repeat
            return recentMessages
        end tell
    `;

    // This script is quite heavy and might need tuning. 
    // Alternatives: Use 'osascript -e' directly for specific handles if known.
}

/**
 * Simpler approach: Use AppleScript to get the last message from a specific chat 
 * OR use shared file monitoring if possible.
 * 
 * Let's try a robust polling script that checks the last 10 seconds of messages.
 */

const SCRIPT = `
tell application "Messages"
    set out to ""
    set myChats to chats
    repeat with c in myChats
        try
            set ms to (messages of c whose date comes after ((current date) - 310))
            repeat with m in ms
                set out to out & (id of m) & "|SEP|" & (contents of m) & "|SEP|" & (handle of participant 1 of c) & "|SEP|" & (from me of m) & "|SEP|" & (date of m) & "\\n"
            end repeat
        end try
    end repeat
    return out
end tell
`;

let seenIds = new Set();

async function check() {
    exec(`osascript -e '${SCRIPT}'`, async (error, stdout) => {
        if (error) return;

        const lines = stdout.trim().split('\n');
        for (const line of lines) {
            if (!line) continue;
            const [id, text, handle, fromMe, date] = line.split('|SEP|');

            if (seenIds.has(id)) continue;
            seenIds.add(id);

            console.log(`New Message from ${handle}: ${text}`);

            // Proactive Drafting (if not from me)
            if (fromMe !== 'true') {
                try {
                    const proactiveAgent = require('./proactive-agent.js');
                    proactiveAgent.processNewMessage(handle, text);
                } catch (e) {
                    console.error("Proactive drafting error:", e);
                }
            }

            // Vectorize
            await addDocuments([{
                id: `live-${id}`,
                text: `[${date}] ${fromMe === 'true' ? 'Me' : handle}: ${text}`,
                source: 'iMessage-live',
                path: `imessage://${handle}`
            }]);

            // Track last contacted
            const contactStore = require('./contact-store.js');
            contactStore.updateLastContacted(handle, date);
        }
    });
}

// Poll every 5 minutes
console.log("iMessage Live Watcher started (Polling every 5m)...");
setInterval(check, 300000);
check();
