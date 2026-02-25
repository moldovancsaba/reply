const http = require('http');

async function testOutbound() {
    console.log("Testing LinkedIn Outbound Persistence (UI-Send Flow)...");

    const payload = {
        recipient: "test-linkedin-user",
        text: "This is a test outbound message from {reply}. Should be saved as Golden Example.",
        trigger: {
            kind: "human_enter",
            at: new Date().toISOString()
        }
    };

    const options = {
        hostname: 'localhost',
        port: 3000,
        path: '/api/send-linkedin',
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

testOutbound();
