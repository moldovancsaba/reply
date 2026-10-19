import http from "node:http";
import { Writable } from "node:stream";
import { createLogger } from "../src/logger.js";
import { createServer } from "../src/server.js";

export const baseConfig = { home: "/tmp/reply-core-test", port: 45511, logLevel: "info", allowedOrigins: [], unknownKeys: [] };

export function memoryLogger(config = baseConfig) {
    const lines = [];
    const stream = new Writable({
        write(chunk, _enc, cb) {
            lines.push(chunk.toString());
            cb();
        },
    });
    return { logger: createLogger(config, stream), lines };
}

// Starts a server on an ephemeral loopback port. `setup(app)` may register extra routes before listen.
export async function startServer({ config = baseConfig, setup, deps } = {}) {
    const { logger, lines } = memoryLogger(config);
    const app = createServer(config, logger, deps);
    setup?.(app);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const port = app.server.address().port;
    return { app, port, lines };
}

// node:http instead of fetch so tests can forge the Host header.
export function request(port, { method = "GET", path = "/", headers = {}, body } = {}) {
    return new Promise((resolve, reject) => {
        const req = http.request({ host: "127.0.0.1", port, method, path, headers }, (res) => {
            let data = "";
            res.on("data", (c) => (data += c));
            res.on("end", () => {
                let json;
                try {
                    json = JSON.parse(data);
                } catch {
                    json = undefined;
                }
                resolve({ status: res.statusCode, json, text: data });
            });
        });
        req.on("error", reject);
        if (body !== undefined) req.write(body);
        req.end();
    });
}
