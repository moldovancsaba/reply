const { analyzeEmail, buildProfile } = require('./style-analyzer.js');

const emails = [
    "Hi Mark,\n\nThanks for the update. Looks good.\n\nBest,\nCsaba",
    "Hello Team,\n\nPlease review the attached document.\n\nRegards,\nCsaba",
    "Hey there,\n\nAre we still on for tomorrow?\n\nCheers,\nC",
    "Dear Mr. Smith,\n\nI am writing to inquire about the status.\n\nSincerely,\nCsaba Moldovan",
    "Hi Mark,\n\nCan you check this?\n\nBest,\nCsaba",
    "Mark,\n\nCall me.\n\nThanks,\nCsaba"
];

console.log("Analyzing 6 sample emails...");
const analyses = emails.map(analyzeEmail);
analyses.forEach((a, i) => console.log(`Email ${i + 1}:`, a));

console.log("\nBuilding Profile...");
const profile = buildProfile(analyses);
console.log(JSON.stringify(profile, null, 2));

// verification assertions
if (profile.sampleSize !== 6) throw new Error("Sample size incorrect");
if (profile.topGreetings[0] !== "hi mark,") console.warn("Expected 'hi mark,' as top greeting. Got:", profile.topGreetings[0]);
// Greetings might include commas depending on regex capture group. 
// My regex captures "Hi", "Hey", "Dear". "Hi Mark," -> "Hi" if my regex is right.
// Let's re-check the output.
