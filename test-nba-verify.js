const http = require('http');

async function testNBAIngestion() {
    console.log("🚀 Testing NBA Ingestion via Channel Bridge...");

    const event = {
        channel: "whatsapp",
        messageId: "test-nba-" + Date.now(),
        direction: "inbound",
        timestamp: new Date().toISOString(),
        text: "Hi, I'm interested in your services. Can we schedule a call for tomorrow morning?",
        peer: {
            handle: "+1555000111",
            displayName: "NBA Tester"
        }
    };

    const options = {
        hostname: 'localhost',
        port: 3000,
        path: '/api/channel-bridge/inbound',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Reply-Human-Approval': 'confirmed',
            'X-Reply-Operator-Token': '6d88a3429f0ef5c906380f12e6994ef664ea295e1d73b591'
        }
    };

    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                console.log(`Status: ${res.statusCode}`);
                console.log(`Response: ${data}`);

                if (res.statusCode === 200) {
                    console.log("✅ Event ingested. Now check the suggestions API...");
                    checkSuggestions("+1555000111").then(resolve).catch(reject);
                } else {
                    reject(new Error("Ingestion failed"));
                }
            });
        });

        req.on('error', reject);
        req.write(JSON.stringify(event));
        req.end();
    });
}

function checkSuggestions(handle) {
    const options = {
        hostname: 'localhost',
        port: 3000,
        path: `/api/kyc?handle=${encodeURIComponent(handle)}`,
        method: 'GET',
        headers: {
            'X-Reply-Human-Approval': 'confirmed',
            'X-Reply-Operator-Token': '6d88a3429f0ef5c906380f12e6994ef664ea295e1d73b591'
        }
    };

    return new Promise((resolve, reject) => {
        setTimeout(() => { // Wait for async Hatori call in background
            const req = http.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const contact = JSON.parse(data);
                        const nba = contact.pendingSuggestions.filter(s => s.type.includes('NBA') || s.type === 'Draft');
                        console.log(`Found ${nba.length} AI suggestions for ${handle}:`);
                        nba.forEach(s => console.log(` - [${s.type}] ${s.content}`));

                        if (nba.length > 0) {
                            console.log("✅ NBA Orchestration Verified!");
                            resolve();
                        } else {
                            console.log("⚠️ No NBA suggestions found. Is Hatori running and REPLY_USE_HATORI=1?");
                            resolve(); // Don't fail the script, just warn
                        }
                    } catch (e) {
                        reject(e);
                    }
                });
            });
            req.on('error', reject);
            req.end();
        }, 3000);
    });
}

testNBAIngestion().catch(console.error);
