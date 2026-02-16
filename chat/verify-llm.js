const { generateReply } = require("./reply-engine.js");

async function run() {
    console.log("Testing LLM generation...");

    const message = "How do I install this project?";
    const context = [
        {
            path: "README.md",
            text: "To install dependencies, run: npm install. To start the server, run: npm start."
        }
    ];

    console.log(`Input: "${message}"`);
    console.log("Context provided: README.md snippet.");

    const reply = await generateReply(message, context);

    console.log("\nGenerated Reply:\n");
    console.log(reply);

    if (reply.toLowerCase().includes("npm install")) {
        console.log("\nSUCCESS: Reply used the provided context!");
    } else {
        console.log("\nWARNING: Reply might not have used context (check output).");
    }
}

run().catch(console.error);
