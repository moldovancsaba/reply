// usage: node core/test/fixtures/build.js --seed 42 --out <dir> [--imessage n] [--mail n] [--whatsapp n] [--contacts n] [--corpus n] [--force]
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildContacts } from "./contacts.js";
import { buildCorpus } from "./corpus.js";
import { buildImessage } from "./imessage.js";
import { buildMail } from "./mail.js";
import { makeRng } from "./rng.js";
import { buildWhatsapp } from "./whatsapp.js";

const DEFAULTS = { imessage: 200, mail: 200, whatsapp: 200, contacts: 25, corpus: 2000 };

export async function buildFixtures({ seed, out, counts = {}, force = false }) {
    const n = { ...DEFAULTS, ...counts };
    if (!Object.values(n).every((v) => Number.isInteger(v) && v >= 0)) throw new Error("counts must be non-negative integers");
    if (existsSync(out) && readdirSync(out).length) {
        if (!force) throw new Error(`output directory ${out} is not empty (use --force)`);
        rmSync(out, { recursive: true, force: true });
    }
    const paths = {
        imessage: path.join(out, "imessage", "chat.db"),
        mail: path.join(out, "mail"),
        whatsapp: path.join(out, "whatsapp", "ChatStorage.sqlite"),
        contacts: path.join(out, "contacts", "contacts.ndjson"),
        corpus: path.join(out, "corpus.ndjson"),
    };
    try {
        for (const d of ["imessage", "whatsapp", "contacts"]) mkdirSync(path.join(out, d), { recursive: true });
        // each source gets its own derived stream so changing one count never changes another source's data
        buildImessage(makeRng(seed * 7 + 1), n.imessage, paths.imessage);
        buildMail(makeRng(seed * 7 + 2), n.mail, paths.mail);
        buildWhatsapp(makeRng(seed * 7 + 3), n.whatsapp, paths.whatsapp);
        buildContacts(makeRng(seed * 7 + 4), n.contacts, paths.contacts);
        await buildCorpus(makeRng(seed * 7 + 5), n.corpus, paths.corpus);
    } catch (err) {
        rmSync(out, { recursive: true, force: true }); // never leave partial output
        throw err;
    }
    paths.mailIndex = path.join(paths.mail, "V10", "MailData", "Envelope Index");
    return paths;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2);
    const get = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
    const seed = Number(get("seed") ?? 42);
    const out = get("out");
    if (!out || !Number.isInteger(seed)) {
        console.error("usage: build.js --seed <int> --out <dir> [--imessage n] [--mail n] [--whatsapp n] [--contacts n] [--corpus n] [--force]");
        process.exit(2);
    }
    const counts = Object.fromEntries(Object.keys(DEFAULTS).filter((k) => get(k) !== undefined).map((k) => [k, Number(get(k))]));
    const t0 = Date.now(); // timing display only, never used for data
    try {
        const paths = await buildFixtures({ seed, out: path.resolve(out), counts, force: args.includes("--force") });
        console.error(`fixtures seed=${seed} counts=${JSON.stringify({ ...DEFAULTS, ...counts })} in ${Date.now() - t0} ms`);
        console.log(JSON.stringify(paths, null, 2));
    } catch (err) {
        console.error(`fixtures failed (seed=${seed}): ${err.message}`);
        process.exit(1);
    }
}
