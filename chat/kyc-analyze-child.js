// Runs KYC contact analysis in an isolated Node process so native-module crashes
// (e.g. segfaults) can't take down the main HTTP server.
//
// IMPORTANT: This script must print ONLY JSON to stdout (server parses it).

// Route logs to stderr to keep stdout clean JSON.
console.log = (...args) => console.error(...args);
console.warn = (...args) => console.error(...args);

const { analyzeContact } = require("./kyc-agent.js");

async function main() {
  const handle = process.argv[2];
  if (!handle) {
    process.stdout.write(JSON.stringify({ status: "error", error: "Missing handle" }));
    process.exit(2);
    return;
  }

  try {
    const profile = await analyzeContact(handle);
    process.stdout.write(JSON.stringify({ status: "ok", profile: profile || null }));
  } catch (e) {
    const msg = (e && (e.message || e.toString())) || "Unknown error";
    process.stdout.write(JSON.stringify({ status: "error", error: msg }));
    process.exit(1);
  }
}

main();

