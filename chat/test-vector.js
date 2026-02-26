const { getUnannotatedDocuments, connect } = require('./vector-store.js');
async function run() {
    const docs = await getUnannotatedDocuments(2);
    console.log("Raw fetched IDs:", docs.map(d => `'${d.id}'`));

    const db = await connect();
    const table = await db.openTable("documents");
    const testId = docs[0].id;
    
    // Test exact match
    const exact = await table.query().where(`id = '${testId}'`).toArray();
    console.log(`Exact match count for ${testId}:`, exact.length);
    
    // Test LIKE match just in case
    const like = await table.query().where(`id LIKE '${testId}%'`).toArray();
    console.log(`LIKE match count for ${testId}:`, like.length);
}
run();
