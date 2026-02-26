/**
 * {reply} - WhatsApp ID Resolver
 * Maps phone numbers to WhatsApp Internal IDs (LIDs) using the local ChatStorage database.
 */

const fs = require("fs");
const path = require("path");

const WA_DB_PATH = path.join(
    process.env.HOME || "",
    "Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite"
);

const whatsAppIdResolver = (() => {
    const MAX_CACHE = 5000;
    const lidToPhone = new Map(); // lidDigits -> { phone, partnerName } | null
    const phoneToLid = new Map(); // phoneDigits -> lidDigits | null

    let waDb = null;
    let openPromise = null;

    function cap(map) {
        while (map.size > MAX_CACHE) map.delete(map.keys().next().value);
    }

    async function ensureDb() {
        if (waDb) return waDb;
        if (openPromise) return openPromise;

        openPromise = (async () => {
            try {
                if (!process.env.HOME) return null;
                if (!fs.existsSync(WA_DB_PATH)) return null;
                const sqlite3 = require("sqlite3").verbose();
                waDb = new sqlite3.Database(WA_DB_PATH, sqlite3.OPEN_READONLY);
                waDb.run("PRAGMA busy_timeout = 5000");
                return waDb;
            } catch (e) {
                console.warn("WhatsApp DB unavailable:", e?.message || e);
                waDb = null;
                return null;
            } finally {
                openPromise = null;
            }
        })();

        return openPromise;
    }

    function all(db, sql, params) {
        return new Promise((resolve, reject) => {
            db.all(sql, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
    }

    function buildInQuery(baseSql, values) {
        const safeValues = Array.isArray(values) ? values : [];
        if (safeValues.length === 0) {
            return { sql: baseSql + "NULL)", params: [] };
        }
        const placeholders = safeValues.map(() => "?").join(",");
        return { sql: baseSql + placeholders + ")", params: safeValues };
    }

    function normalizeWhatsAppContactJid(contactJid) {
        if (!contactJid) return null;
        const v = String(contactJid).trim();
        if (!v) return null;
        if (v.includes("@")) return v.split("@")[0];
        return v;
    }

    async function phoneForLids(lidDigitsList) {
        const lids = Array.from(new Set((lidDigitsList || []).map((v) => String(v || "").trim()).filter(Boolean)));
        const out = new Map();

        for (const lid of lids) {
            if (lidToPhone.has(lid)) {
                const cached = lidToPhone.get(lid);
                if (cached) out.set(lid, cached);
            }
        }

        const missing = lids.filter((lid) => !lidToPhone.has(lid));
        if (missing.length === 0) return out;

        const db = await ensureDb();
        if (!db) return out;

        const CHUNK = 400;
        for (let i = 0; i < missing.length; i += CHUNK) {
            const chunk = missing.slice(i, i + CHUNK);
            const ids = chunk.map((lid) => `${lid}@lid`);
            const query = buildInQuery(
                "SELECT ZCONTACTIDENTIFIER, ZCONTACTJID, ZPARTNERNAME FROM ZWACHATSESSION WHERE ZCONTACTIDENTIFIER IN (",
                ids
            );

            let rows = [];
            try {
                rows = await all(db, query.sql, query.params);
            } catch (e) {
                console.warn("WhatsApp lid mapping query failed:", e?.message || e);
                break;
            }

            const foundLids = new Set();
            for (const r of rows) {
                const identifier = (r?.ZCONTACTIDENTIFIER || "").toString();
                const lidDigits = identifier.endsWith("@lid") ? identifier.slice(0, -4) : identifier;
                if (!lidDigits) continue;

                const phone = normalizeWhatsAppContactJid(r?.ZCONTACTJID || "");
                if (!phone) continue;

                const meta = { phone, partnerName: (r?.ZPARTNERNAME || "").toString() };
                lidToPhone.set(lidDigits, meta);
                // We don't import normalizePhone here to avoid circularity, 
                // the phone from DB is usually clean digits.
                phoneToLid.set(phone, lidDigits);
                cap(lidToPhone);
                cap(phoneToLid);

                out.set(lidDigits, meta);
                foundLids.add(lidDigits);
            }

            chunk.forEach((lid) => {
                if (!foundLids.has(lid)) lidToPhone.set(lid, null);
            });
            cap(lidToPhone);
        }

        return out;
    }

    async function lidsForPhones(phoneDigitsList) {
        const phones = Array.from(new Set((phoneDigitsList || []).map((v) => String(v || "").trim()).filter(Boolean)));
        const out = new Map();

        for (const p of phones) {
            if (phoneToLid.has(p)) {
                const cached = phoneToLid.get(p);
                if (cached) out.set(p, cached);
            }
        }

        const missing = phones.filter((p) => !phoneToLid.has(p));
        if (missing.length === 0) return out;

        const db = await ensureDb();
        if (!db) return out;

        const CHUNK = 400;
        for (let i = 0; i < missing.length; i += CHUNK) {
            const chunk = missing.slice(i, i + CHUNK);
            const jids = chunk.map((p) => `${p}@s.whatsapp.net`);
            const query = buildInQuery(
                "SELECT ZCONTACTJID, ZCONTACTIDENTIFIER FROM ZWACHATSESSION WHERE ZCONTACTJID IN (",
                jids
            );

            let rows = [];
            try {
                rows = await all(db, query.sql, query.params);
            } catch (e) {
                console.warn("WhatsApp phone mapping query failed:", e?.message || e);
                break;
            }

            const foundPhones = new Set();
            for (const r of rows) {
                const phone = normalizeWhatsAppContactJid(r?.ZCONTACTJID || "");
                if (!phone) continue;
                const identifier = (r?.ZCONTACTIDENTIFIER || "").toString();
                const lidDigits = identifier.endsWith("@lid") ? identifier.slice(0, -4) : null;
                phoneToLid.set(phone, lidDigits || null);
                cap(phoneToLid);
                foundPhones.add(phone);
                if (lidDigits) out.set(phone, lidDigits);
            }

            chunk.forEach((p) => {
                if (!foundPhones.has(p)) phoneToLid.set(p, null);
            });
            cap(phoneToLid);
        }

        return out;
    }

    return { phoneForLids, lidsForPhones };
})();

module.exports = whatsAppIdResolver;
