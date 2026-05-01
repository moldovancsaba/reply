const { assembleReplyContext } = require('./context-engine.js');
async function test() {
    console.log("Fetching context for a test query...");
    const bundle = await assembleReplyContext("linkedin", "+36301234567");
    console.log("=== RAG FACTS ===");
    console.log(bundle.facts);
}
test();
