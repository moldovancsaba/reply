import { mkdirSync } from "node:fs";
import { ConfigError, loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { createRotatingStream } from "./logfile.js";
import { createServer, gracefulClose } from "./server.js";
import { createRegistry } from "./connectors/registry.js";
import { createRunner } from "./connectors/runner.js";
import { createScheduler } from "./connectors/scheduler.js";
import { createDrafting } from "./drafting/service.js";
import { createHandoff } from "./handoff/service.js";
import { createIdentity } from "./identity/service.js";
import { createBackupSchedule } from "./ops/auto.js";
import { removePidfile, writePidfile } from "./ops/guard.js";
import { createFakeDrivers, createAppleScriptDrivers, createNudges } from "./send/drivers.js";
import { createWhatsAppConnector } from "./connectors/whatsapp.js";
import { createSender } from "./send/service.js";
import { createUploads } from "./send/uploads.js";
import { createProfile } from "./profile/service.js";
import { createReadService } from "./read/service.js";
import { defaultHelperPath } from "./helper/index.js";
import { createStatus } from "./status/index.js";
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

const logger = createLogger(config, config.logFile ? createRotatingStream({ file: config.logFile, maxBytes: config.logMaxBytes }) : undefined);
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
const registry = createRegistry({ enabled: config.connectors, deps: { config, logger } });
for (const id of registry.unknown) logger.warn({ connector: id }, "ignoring unknown connector in REPLY_CORE_CONNECTORS");
const identity = createIdentity({ db: storage.db, repo });
repo.setAfterBatch(() => identity.applyPendingMerges());
const runner = createRunner({ db: storage.db, repo, logger, onNames: (names) => identity.applyNames(names), onGroups: (groups) => identity.setGroupMembers(groups), onContacts: (people) => {
        const r = identity.importContacts(people);
        identity.applyPendingMerges();
        logger.info({ connector: "contacts", created: r.created, updated: r.updated, unchanged: r.unchanged, linked: r.linked, conflicts: r.conflicts.length, protectedByMerge: r.protectedByMerge }, "identity.import");
        return r;
    },
});
const scheduler = createScheduler({ registry, runner, repo, logger, intervals: config.intervals });
const handoffs = createHandoff({ db: storage.db });
const drivers = config.sendDriver === "fake" ? createFakeDrivers(config.home) : createAppleScriptDrivers();
const SYNC_AFTER_SEND = { imessage: "imessage", email: "apple-mail", whatsapp: "whatsapp" };
const uploads = createUploads({ home: config.home });
const whatsappForConfirm = registry.get("whatsapp") ?? createWhatsAppConnector({ config, logger });
const sender = createSender({
    db: storage.db, handoffs, drivers, uploads, enabled: config.sending, logger,
    // a sent WhatsApp message is looked for in WhatsApp's database, also when the WhatsApp source is not switched on for syncing
    confirmers: config.sendDriver === "fake" ? {} : { whatsapp: (m) => whatsappForConfirm.confirmSent(m) },
    nudges: config.sendDriver === "fake" ? {} : createNudges(),
    // the sent message reaches the source app's database a moment later: read the source again, twice, to pick it up
    onSent: (channel) => { for (const delay of [3000, 12000]) setTimeout(() => { const c = registry.get(SYNC_AFTER_SEND[channel]); if (c && !runner.isRunning(c.id, "")) runner.start(c, "")?.done.catch(() => {}); }, delay).unref(); },
});
const read = createReadService({ db: storage.db, replyChannels: (id) => handoffs.channelsFor(id).map((c) => ({ ...c, send: sender.capability(c.channel) })) });
const drafting = createDrafting({ config, read, logger });
const profile = createProfile({ db: storage.db });
const status = createStatus({ db: storage.db, config, registry, runner, scheduler, repo, helper: defaultHelperPath() });
const app = createServer(config, logger, { registry, runner, repo, identity, read, profile, sender, uploads, appPath: config.appPath, status, handoffs, drafting, logger, uiDir: config.uiDir });

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
const backups = createBackupSchedule({ home: config.home, db: storage.db, logger });
backups.start();
writePidfile(config.home, config.port);
console.log(`reply-core listening on http://${HOST}:${config.port} (home=${config.home})`);

let closing = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, async () => {
        if (closing) return;
        closing = true;
        logger.info({ signal }, "shutting down");
        await scheduler.stop();
        backups.stop();
        removePidfile(config.home);
        const result = await gracefulClose(app, 5000);
        storage.db.close();
        process.exit(result === "closed" ? 0 : 1);
    });
}
