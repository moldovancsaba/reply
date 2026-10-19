import { mkdirSync } from "node:fs";
import { ConfigError, loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { createServer, gracefulClose } from "./server.js";

const EXIT_CONFIG = 78;
const EXIT_PORT_IN_USE = 75;
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
const app = createServer(config, logger);

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
console.log(`reply-core listening on http://${HOST}:${config.port} (home=${config.home})`);

let closing = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, async () => {
        if (closing) return;
        closing = true;
        logger.info({ signal }, "shutting down");
        const result = await gracefulClose(app, 5000);
        process.exit(result === "closed" ? 0 : 1);
    });
}
