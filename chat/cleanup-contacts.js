const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data', 'contacts.json');

function cleanup() {
    if (!fs.existsSync(DATA_FILE)) return;
    const contacts = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    const merged = {};

    contacts.forEach(c => {
        const handle = (c.handle || c.displayName).toLowerCase().trim();
        if (!merged[handle]) {
            merged[handle] = c;
        } else {
            console.log(`Merging duplicate for ${handle}...`);
            // Merge metadata if the current one has more info
            const existing = merged[handle];

            // Priority: Keep the one with relationship/profession if possible
            if (!existing.relationship && c.relationship) existing.relationship = c.relationship;
            if (!existing.profession && c.profession) existing.profession = c.profession;
            if (!existing.notes && c.notes) existing.notes = c.notes;
            if ((!existing.lastContacted || new Date(c.lastContacted) > new Date(existing.lastContacted)) && c.lastContacted) {
                existing.lastContacted = c.lastContacted;
            }
            if (c.draft && !existing.draft) existing.draft = c.draft;
            if (c.status === 'draft' && existing.status !== 'draft') existing.status = 'draft';
        }
    });

    const result = Object.values(merged);
    fs.writeFileSync(DATA_FILE, JSON.stringify(result, null, 2));
    console.log(`Cleanup complete. Contacts reduced from ${contacts.length} to ${result.length}.`);
}

cleanup();
