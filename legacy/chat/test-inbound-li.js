const http = require('http');

async function testInbound() {
    console.log("Testing LinkedIn Inbound Bridge Persistence...");

    const payload = {
        channel: "linkedin",
        timestamp: new Date().toISOString(),
        peer: {
            handle: "test-linkedin-user",
            displayName: "LinkedIn Test User"
        },
        text: "Hello from LinkedIn! This should be in both Vector and SQLite stores.",
        messageId: "li-test-" + Date.now()
    };

    const options = {
        hostname: 'localhost',
        port: 3000,
        path: '/api/channel-bridge/inbound',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Reply-Operator-Token': 'reply-local-operator-token-2026',
            'X-Reply-Human-Approval': 'confirmed'
        }
    };

    const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
            console.log('Response:', data);
            process.exit(0);
        });
    });

    req.on('error', (e) => {
        console.error('Request failed:', e);
        process.exit(1);
    });

    req.write(JSON.stringify(payload));
    req.end();
}

testInbound();
