const fs = require('fs');
const json = JSON.parse(fs.readFileSync('board_items.json', 'utf8'));
const items = json.items || [];

const replyItems = items.filter(i =>
    (i.content?.repository === 'reply' || i.content?.url?.includes('/reply/')) ||
    (i.product === 'reply') ||
    (i.title?.includes('Multi-Model') || i.title?.includes('Context Engine') || i.title?.includes('Control Panel'))
);

console.log("Total Reply Items:", replyItems.length);

console.log("\n--- Potential Duplicates ---");
const titles = {};
replyItems.forEach(i => {
    const id = i.content?.number || 'Draft';
    const repo = i.content?.repository || 'Unknown Repo';
    if (titles[i.title]) {
        console.log(`DUPLICATE: "${i.title}"\n  - Item 1: ID ${titles[i.title].id} (Repo: ${titles[i.title].repo})\n  - Item 2: ID ${id} (Repo: ${repo})`);
    } else {
        titles[i.title] = { id, repo };
    }
});

console.log("\n--- Unassigned / Wrong Agent ---");
replyItems.forEach(i => {
    if (i.agent !== 'Agnes') {
        const title = i.title || "No Title";
        const agent = i.agent || "Unassigned";
        const id = i.content?.number || i.id;
        console.log(`WRONG AGENT: #${id} "${title}" is assigned to "${agent}" (Item ID: ${i.id})`);
    }
});
