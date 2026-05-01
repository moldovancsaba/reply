const { getContext } = require('./context-engine.js');
const fs = require('fs');
const path = require('path');

async function verify() {
    const profilePath = path.join(__dirname, '..', 'knowledge', 'style-profile.json');

    if (!fs.existsSync(profilePath)) {
        console.log("WAITING: style-profile.json does not exist yet.");
        return;
    }

    console.log("Profile found! Loading context...");
    const { styleInstructions, history } = await getContext("test-recipient@example.com");

    const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));

    console.log("\n--- Analyzed Profile ---");
    console.log(`Avg Word Count: ${profile.averageLength}`);
    console.log(`Top Greetings: ${profile.topGreetings.join(", ")}`);
    console.log(`Top Sign-offs: ${profile.topSignOffs.join(", ")}`);

    console.log("\n--- Generated System Instruction ---");
    console.log(styleInstructions);

    console.log("\n--- Recipient History (Mock/Empty if not indexed) ---");
    console.log(history || "(No history found)");
}

verify();
