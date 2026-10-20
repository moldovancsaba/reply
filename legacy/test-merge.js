const contactStore = require('./chat/contact-store.js');

async function runTest() {
    console.log("Waiting for DB init...");
    await contactStore.waitUntilReady();

    console.log("Creating Test Primary...");
    const target = await contactStore.updateContact('test_primary@example.com', {
        displayName: "Test Primary Identity",
        channels: { email: ['test_primary@example.com'] }
    });

    console.log("Creating Test Alias (WhatsApp)...");
    const source = await contactStore.updateContact('+1234567890', {
        displayName: "Test Alias Identity",
        channels: { phone: ['+1234567890'] }
    });

    console.log(`Target ID: ${target.id}`);
    console.log(`Source ID: ${source.id}`);

    // Add some notes to the source to prove they migrate
    await contactStore.addNote('+1234567890', 'This is a note strictly on the alias profile');

    console.log("Merging source into target...");
    await contactStore.mergeContacts(target.id, source.id);

    console.log("Checking findContact by alias handle (+1234567890)...");
    const resolved = contactStore.findContact('+1234567890');

    if (resolved && resolved.id === target.id) {
        console.log("SUCCESS! Looking up the alias resolved to the primary profile.");
        console.log("Resolved Profile Name:", resolved.displayName);
        console.log("Resolved Channels:", resolved.channels);
        console.log("Resolved Notes:", resolved.notes.map(n => n.text));
    } else {
        console.error("FAILED! Lookup returned:", resolved);
    }
}

runTest().catch(console.error);
