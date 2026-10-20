const https = require('https');
require('dotenv').config();

const API_KEY = process.env.GOOGLE_API_KEY;

const options = {
    hostname: 'generativelanguage.googleapis.com',
    path: `/v1beta/models?key=${API_KEY}`,
    method: 'GET',
    headers: { 'Content-Type': 'application/json' }
};

const req = https.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => data += chunk);
    res.on('end', () => {
        console.log("Status:", res.statusCode);
        console.log("Body:", data);
    });
});

req.on('error', (e) => console.error(e));
req.end();
