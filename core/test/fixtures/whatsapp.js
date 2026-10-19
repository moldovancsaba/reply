import Database from "better-sqlite3";
import { makePeople, randomTs, sentence } from "./people.js";

const CORE_DATA_EPOCH_S = 978307200;

const SCHEMA = `
CREATE TABLE ZWACHATSESSION (Z_PK INTEGER PRIMARY KEY, ZCONTACTJID TEXT, ZPARTNERNAME TEXT, ZCONTACTIDENTIFIER TEXT);
CREATE TABLE ZWAMESSAGE (
  Z_PK INTEGER PRIMARY KEY, ZTEXT TEXT, ZMESSAGEDATE REAL, ZISFROMME INTEGER, ZFROMJID TEXT, ZTOJID TEXT,
  ZCHATSESSION INTEGER, ZMEDIAITEM INTEGER, ZPUSHNAME TEXT, ZMESSAGETYPE INTEGER, ZSTANZAID TEXT
);
CREATE TABLE Z_METADATA (Z_VERSION INTEGER, Z_UUID TEXT, Z_PLIST BLOB);
`;

export function buildWhatsapp(rng, n, outPath) {
    const db = new Database(outPath);
    db.exec(SCHEMA);
    db.prepare("INSERT INTO Z_METADATA (Z_VERSION, Z_UUID) VALUES (1, 'FIXTURE-UUID-0001')").run();
    const people = makePeople(rng, 25);
    const sessions = [];
    const insSession = db.prepare("INSERT INTO ZWACHATSESSION (Z_PK, ZCONTACTJID, ZPARTNERNAME, ZCONTACTIDENTIFIER) VALUES (?, ?, ?, ?)");
    people.slice(0, 12).forEach((p, i) => {
        const jid = `${p.phone.slice(1)}@s.whatsapp.net`;
        insSession.run(i + 1, jid, p.name, null);
        sessions.push({ pk: i + 1, jid, group: false, person: p });
    });
    insSession.run(100, "120363000000000001@g.us", "Synthetic group", null);
    sessions.push({ pk: 100, jid: "120363000000000001@g.us", group: true });
    insSession.run(101, "status@broadcast", "Status", null);
    const self = "12125550000@s.whatsapp.net";
    const ins = db.prepare(`INSERT INTO ZWAMESSAGE (Z_PK, ZTEXT, ZMESSAGEDATE, ZISFROMME, ZFROMJID, ZTOJID, ZCHATSESSION, ZMEDIAITEM, ZPUSHNAME, ZMESSAGETYPE, ZSTANZAID)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    db.transaction(() => {
        const times = Array.from({ length: n }, () => randomTs(rng)).sort((a, b) => a - b);
        times.forEach((ts, i) => {
            const pk = i + 1;
            const s = sessions[rng.int(sessions.length)];
            const fromMe = rng() < 0.45;
            const date = ts / 1000 - CORE_DATA_EPOCH_S;
            const roll = rng();
            let text = sentence(rng);
            let media = null;
            let type = 0;
            if (roll < 0.08) { text = null; media = pk; type = 1; } // media-only
            else if (roll < 0.12) { text = "You were added"; type = 10; } // system row
            const memberJid = s.group ? `${people[rng.int(3)].phone.slice(1)}@s.whatsapp.net` : s.jid;
            ins.run(pk, text, date, fromMe ? 1 : 0, fromMe ? self : memberJid, fromMe ? s.jid : self, s.pk, media, null, type, `STANZA${pk}`);
        });
        // one status broadcast row (must be skipped by connectors)
        const pk = n + 1;
        ins.run(pk, "status update", (times.at(-1) ?? 0) / 1000 - CORE_DATA_EPOCH_S + 60, 0, "12125550101@s.whatsapp.net", "status@broadcast", 101, null, null, 0, `STANZA${pk}`);
    })();
    db.close();
}
