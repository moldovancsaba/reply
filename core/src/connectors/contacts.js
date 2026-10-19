import { createHash } from "node:crypto";
import { defaultHelperPath, helperDoctor, HelperError, runHelper } from "../helper/index.js";
import { normalizeHandle } from "../identity/normalize.js";
import { ConnectorError } from "./errors.js";

const HINTS = {
    permission_denied: "Allow Contacts for the app that starts Reply Core in System Settings > Privacy & Security > Contacts, then recheck.",
    helper_unavailable: "The native helper is not built. Run core/helper/build.sh.",
};

// The address-book fields shown on the profile; empty ones are left out so the stored JSON (and the fingerprint) is stable.
export function detailsOf(rec) {
    const text = (v) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 300) : undefined);
    const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim().slice(0, 500)).slice(0, 20) : []);
    const d = { givenName: text(rec.givenName), familyName: text(rec.familyName), nickname: text(rec.nickname), organization: text(rec.organization), jobTitle: text(rec.jobTitle), department: text(rec.department), birthday: text(rec.birthday), urls: list(rec.urls), addresses: list(rec.addresses) };
    for (const k of Object.keys(d)) if (d[k] === undefined || (Array.isArray(d[k]) && d[k].length === 0)) delete d[k];
    return d;
}

// One person from the helper -> an import entry (handles linked by the user's own address book), or why it is skipped.
// Every phone also gets its WhatsApp twin `<e164>@wa`, so one person's iMessage and WhatsApp share a contact.
export function toImport(rec, region) {
    const handles = new Map();
    let skippedHandles = 0;
    const add = (h) => { if (h) handles.set(h.handle_norm, { handle_norm: h.handle_norm, kind: h.kind }); };
    for (const phone of rec.phones ?? []) {
        const h = normalizeHandle(phone, "phone", region);
        if (!h) { skippedHandles++; continue; }
        add(h);
        add({ handle_norm: `${h.handle_norm}@wa`, kind: "whatsapp" });
    }
    for (const email of rec.emails ?? []) {
        const h = normalizeHandle(email, "email", region);
        if (!h) skippedHandles++;
        else add(h);
    }
    if (!handles.size) return { skip: "no_handles", skippedHandles };
    const list = [...handles.values()].sort((a, b) => a.handle_norm.localeCompare(b.handle_norm));
    const details = detailsOf(rec);
    const fingerprint = createHash("sha256").update(JSON.stringify([rec.displayName, list.map((h) => h.handle_norm), details])).digest("hex").slice(0, 32);
    return { person: { externalId: rec.contactId, displayName: rec.displayName || list[0].handle_norm, handles: list, details, fingerprint }, skippedHandles };
}

export function createContactsConnector({ config = {}, logger, helper = defaultHelperPath() } = {}) {
    const region = config.defaultRegion ?? "HU";
    const asConnectorError = (e) => (e instanceof HelperError ? Object.assign(new ConnectorError(e.code, e.message, { hint: HINTS[e.code] }), { cause: e }) : e);
    return {
        id: "contacts",
        channel: "contacts",
        intervalMs: 15 * 60_000,
        accounts: async () => [""],
        async preflight() {
            try {
                const { report } = await helperDoctor(["--only", "contacts"], { helper, timeoutMs: 10_000 });
                // needs_consent is fine: the first export shows the macOS prompt
                if (report.contacts === "ok" || report.contacts === "needs_consent") return { ok: true };
                return { ok: false, code: report.contacts, hint: HINTS[report.contacts] };
            } catch (e) {
                if (e instanceof HelperError) return { ok: false, code: e.code, hint: HINTS[e.code] ?? e.message };
                throw e;
            }
        },
        // The Contacts framework has no modification date, so every call exports everyone in one page; unchanged people
        // are skipped by fingerprint inside the identity import.
        async fetch(_account, _cursor, { signal }) {
            const t0 = performance.now();
            let out;
            try {
                out = await runHelper(["contacts"], { helper, signal, timeoutMs: 30_000 });
            } catch (e) {
                throw asConnectorError(e);
            }
            const contacts = [];
            let noHandles = 0;
            let badHandles = 0;
            for (const rec of out.contacts) {
                const r = toImport(rec, region);
                badHandles += r.skippedHandles;
                if (r.skip) noHandles++;
                else contacts.push(r.person);
            }
            logger?.info({ connector: "contacts", people: contacts.length, noHandles, badHandles, ms: Math.round(performance.now() - t0) }, "connector.contacts page");
            return { messages: [], contacts, nextCursor: {}, more: false, total: contacts.length };
        },
    };
}
