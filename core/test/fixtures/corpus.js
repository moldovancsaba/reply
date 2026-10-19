import { createWriteStream } from "node:fs";
import { makePeople, randomTs, sentence } from "./people.js";

// NormalizedMessage lines (see Storage issue) for storage and performance tests. Streams to disk.
export function buildCorpus(rng, n, outPath) {
    return new Promise((resolve, reject) => {
        const people = makePeople(rng, 2000);
        const channels = ["imessage", "email", "whatsapp"];
        const ws = createWriteStream(outPath);
        ws.on("error", reject);
        ws.on("finish", resolve);
        let i = 0;
        const write = () => {
            while (i < n) {
                const p = people[rng.int(people.length)];
                const channel = channels[rng.int(3)];
                const handle = channel === "email" ? p.email : channel === "whatsapp" ? `${p.phone}@wa` : p.phone;
                const line = JSON.stringify({ channel, account: "", providerMessageKey: `c${i}`, threadKey: `t${i % 500}`, handle_norm: handle, isFromMe: rng() < 0.45, tsMs: randomTs(rng), text: sentence(rng), attachments: [] }) + "\n";
                i++;
                if (!ws.write(line)) return ws.once("drain", write);
            }
            ws.end();
        };
        write();
    });
}
