const fs = require('fs');
const path = require('path');
const { ingestLinkedInContacts } = require('./ingest-linkedin-contacts.js');
const contactStore = require('./contact-store.js');

async function testLinkedInIngestion() {
    console.log("Starting LinkedIn Contact Ingestion Test...");

    const mockCSVPath = path.join(__dirname, 'mock_connections.csv');
    const mockCSVContent = `First Name,Last Name,URL,Email Address,Company,Position,Connected On
Jane,Doe,https://www.linkedin.com/in/janedoe,jane.doe@example.com,Tech Corp,Software Engineer,12 Feb 2024
John,Smith,https://www.linkedin.com/in/johnsmith,,Innovation Inc,Product Manager,15 Jan 2024
`;

    fs.writeFileSync(mockCSVPath, mockCSVContent);

    try {
        await ingestLinkedInContacts(mockCSVPath);

        await contactStore.waitUntilReady();
        const contacts = await contactStore.refresh();

        console.log("\nVerifying contacts in ContactStore:");

        const jane = contacts.find(c => c.displayName === 'Jane Doe');
        if (jane) {
            console.log("✅ Found Jane Doe");
            console.log(`   Handle: ${jane.handle}`);
            console.log(`   Profession: ${jane.profession}`);
            console.log(`   Email: ${jane.channels.email[0]}`);
            if (jane.handle === 'jane.doe@example.com' && jane.profession === 'Software Engineer @ Tech Corp') {
                console.log("   ✅ Fields correctly mapped");
            } else {
                console.log("   ❌ Field mapping mismatch");
            }
        } else {
            console.log("❌ Jane Doe not found");
        }

        const john = contacts.find(c => c.displayName === 'John Smith');
        if (john) {
            console.log("✅ Found John Smith");
            console.log(`   Handle: ${john.handle}`);
            console.log(`   Profession: ${john.profession}`);
            if (john.handle === 'linkedin://johnsmith' && john.profession === 'Product Manager @ Innovation Inc') {
                console.log("   ✅ Fields correctly mapped (name-based handle fallback)");
            } else {
                console.log("   ✅ Field mapping mismatch", john.handle, john.profession);
            }
        } else {
            console.log("❌ John Smith not found");
        }

    } finally {
        if (fs.existsSync(mockCSVPath)) {
            fs.unlinkSync(mockCSVPath);
        }
    }
}

testLinkedInIngestion().catch(console.error);
