const fs = require('fs');
const json = JSON.parse(fs.readFileSync('board_items.json', 'utf8'));
const items = json.items || [];

const PROJECT_ID = "PVT_kwHOACGtF84BOtVF";
const AGENT_FIELD_ID = "PVTSSF_lAHOACGtF84BOtVFzg9VLQc";
const AGNES_OPTION_ID = "4f732411";

const legacyDuplicates = [3, 4, 5, 6, 7, 8]; // In reply repo

console.log("#!/bin/bash");
console.log("echo 'Starting Board Fix...'");

items.forEach(i => {
    const isReplyProduct = i.product === 'reply' || i.content?.repository === 'moldovancsaba/reply' || i.title?.includes('Reply:');
    const number = i.content?.number;
    const repo = i.content?.repository;

    // 1. Archive Legacy Duplicates
    if (repo === 'moldovancsaba/reply' && legacyDuplicates.includes(number)) {
        console.log(`echo "Archiving Duplicate #${number} (${i.id})..."`);
        console.log(`gh project item-archive 1 --owner moldovancsaba --id ${i.id}`);
    }

    // 2. Assign Agnes to Active/Relevant Items
    // We assign Agnes if:
    // - It's a Reply product item
    // - AND it's NOT a legacy duplicate we just archived
    // - AND it's not already assigned to Agnes
    if (isReplyProduct && !(repo === 'moldovancsaba/reply' && legacyDuplicates.includes(number)) && i.agent !== 'Agnes') {
        console.log(`echo "Assigning Agnes to #${number} (${i.id})..."`);
        console.log(`gh project item-edit --project-id ${PROJECT_ID} --id ${i.id} --field-id ${AGENT_FIELD_ID} --single-select-option-id ${AGNES_OPTION_ID}`);
    }
});
