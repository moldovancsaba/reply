import { readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));

export function registerHealth(app, config) {
    app.get("/api/health", async () => ({
        status: "ok",
        version,
        uptimeSeconds: Math.floor(process.uptime()),
        home: config.home,
        time: new Date().toISOString(),
    }));
}
