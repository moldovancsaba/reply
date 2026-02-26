const { annotateDocument, getUnannotatedDocuments } = require('./vector-store.js');
async function test() {
    const docs = await getUnannotatedDocuments(1);
    if (!docs.length) { console.log("No docs available"); return; }
    const doc = docs[0];
    console.log("Testing update on:", doc.id);
    const success = await annotateDocument(doc.id, { tags: ["test"], summary: "test sum", facts: ["fact 1"] });
    console.log("Success?", success);
}
test();
