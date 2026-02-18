const fs = require('fs');
const FILE = './chat/data/contacts.json';

try {
    const data = fs.readFileSync(FILE, 'utf8');
    JSON.parse(data);
    console.log("JSON is Valid");
} catch (e) {
    console.error("JSON Error:", e.message);
    if (e.message.includes("at position")) {
        const pos = parseInt(e.message.match(/position (\d+)/)[1]);
        const start = Math.max(0, pos - 50);
        const end = Math.min(data.length, pos + 50);
        console.log("Context:");
        console.log(data.substring(start, end));
        console.log("Pointer:");
        console.log(" ".repeat(pos - start) + "^");
    }
}
