const { exec } = require('child_process');

/**
 * Sends an iMessage via AppleScript.
 * @param {string} target - Handle (email or phone)
 * @param {string} message - Content
 */
function sendIMessage(target, message) {
    const escapedMessage = message.replace(/"/g, '\\"');
    const appleScript = `
        tell application "Messages"
            set targetService to 1st service whose service type is iMessage
            set targetBuddy to buddy "${target}" of targetService
            send "${escapedMessage}" to targetBuddy
        end tell
    `;

    exec(`osascript -e '${appleScript}'`, (error, stdout, stderr) => {
        if (error) {
            console.error(`Error sending message: ${error}`);
            return;
        }
        console.log(`Message sent to ${target}: ${stdout}`);
    });
}

// Example usage (uncomment to test):
// sendIMessage("+36706006555", "Hello from Reply Engine!");
