import { mkdirSync } from "node:fs";
import { ConfigError, loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { createServer, gracefulClose } from "./server.js";
import { createRegistry } from "./connectors/registry.js";
import { createRunner } from "./connectors/runner.js";
import { createScheduler } from "./connectors/scheduler.js";
import { openDb } from "./storage/db.js";
import { createRepo } from "./storage/repo.js";

const EXIT_CONFIG = 78;
const EXIT_PORT_IN_USE = 75;
const EXIT_STORAGE = 74;
const HOST = "127.0.0.1";

let config;
try {
    config = loadConfig(process.env);
    mkdirSync(config.home, { recursive: true, mode: 0o700 });
} catch (err) {
    const reason = err instanceof ConfigError ? err.message : `REPLY_CORE_HOME is not usable (${err.code ?? err.message})`;
    console.error(`reply-core: invalid configuration: ${reason}`);
    process.exit(EXIT_CONFIG);
}

const logger = createLogger(config);
for (const key of config.unknownKeys) logger.info({ key }, "ignoring unknown REPLY_CORE_* setting");
let storage;
try {
    storage = openDb(config.home);
} catch (err) {
    logger.error({ code: err.code, err }, err.code ?? "storage_unavailable");
    console.error(`reply-core: storage error (${err.code ?? "unknown"}): ${err.message}. Restore a backup or delete core.db and re-ingest.`);
    process.exit(EXIT_STORAGE);
}
const repo = createRepo(storage.db);
const registry = createRegistry({ enabled: config.connectors });
for (const id of registry.unknown) logger.warn({ connector: id }, "ignoring unknown connector in REPLY_CORE_CONNECTORS");
const runner = createRunner({ db: storage.db, repo, logger });
const scheduler = createScheduler({ registry, runner, repo, logger, intervals: config.intervals });
const app = createServer(config, logger, { registry, runner, repo });

try {
    await app.listen({ host: HOST, port: config.port });
} catch (err) {
    if (err.code === "EADDRINUSE") {
        console.error(`reply-core: port ${config.port} is already in use. Is Reply Core already running?`);
        process.exit(EXIT_PORT_IN_USE);
    }
    logger.error({ err }, "failed to start");
    process.exit(1);
}
scheduler.start();
console.log(`reply-core listening on http://${HOST}:${config.port} (home=${config.home})`);

let closing = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, async () => {
        if (closing) return;
        closing = true;
        logger.info({ signal }, "shutting down");
        await scheduler.stop();
        const result = await gracefulClose(app, 5000);
        storage.db.close();
        process.exit(result === "closed" ? 0 : 1);
    });
}
