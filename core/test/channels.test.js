import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import Ajv from "ajv";
import { canReceive, CH, channelIds, DESCRIPTORS, descriptorOf, isChannel, ordered, validateRegistry } from "../src/channels/registry.js";
import { CHANNELS } from "../src/storage/repo.js";
import { request, startServer } from "./helpers.js";

const good = () => structuredClone(DESCRIPTORS[0]);
const withChange = (id, mutate) => { const d = good(); d.id = id; mutate(d); return d; };

test("the registry holds the three channels in display order with today's capabilities", () => {
    assert.deepEqual(channelIds(), ["imessage", "email", "whatsapp"]);
    assert.deepEqual(CHANNELS, channelIds(), "storage re-exports the registry's ids");
    assert.deepEqual(ordered().map((d) => d.order), [10, 20, 30]);
    assert.deepEqual(CH, { imessage: "imessage", email: "email", whatsapp: "whatsapp" });
    assert.equal(descriptorOf("whatsapp").capabilities.files, false);
    assert.equal(descriptorOf("imessage").capabilities.files, true);
    assert.equal(descriptorOf("whatsapp").deliveryCheck, "external");
    assert.equal(isChannel("email"), true);
    assert.equal(isChannel("telegram"), false);
    assert.equal(descriptorOf("telegram"), null);
});

test("registry validation names the descriptor and the rule", () => {
    const a = good();
    const b = { ...good(), id: "other", order: 99 };
    assert.doesNotThrow(() => validateRegistry([a, b]));
    const cases = [
        ["duplicate id", [a, { ...b, id: a.id }], /imessage: duplicate id/],
        ["duplicate order", [a, { ...b, order: a.order }], /other: order must be a unique integer/],
        ["id with uppercase", [withChange("Telegram", () => {})], /id must match/],
        ["id too long", [withChange("x".repeat(33), () => {})], /id must match/],
        ["id starting with a digit", [withChange("1tele", () => {})], /id must match/],
        ["missing label", [withChange("tele", (d) => { d.label = ""; })], /label and appLabel are required/],
        ["missing capability", [withChange("tele", (d) => { delete d.capabilities.files; })], /capabilities needs boolean/],
        ["no recipient kinds", [withChange("tele", (d) => { d.recipient = { kinds: [] }; })], /recipient\.kinds/],
        ["unknown link builder", [withChange("tele", (d) => { d.handoffUrl = "tg"; })], /handoffUrl must be one of/],
        ["unknown delivery check", [withChange("tele", (d) => { d.deliveryCheck = "maybe"; })], /deliveryCheck must be/],
        ["missing connector", [withChange("tele", (d) => { delete d.connector; })], /connector/],
    ];
    for (const [name, list, re] of cases) assert.throws(() => validateRegistry(list), re, name);
    for (const [, list] of cases) assert.throws(() => validateRegistry(list), /^Error: channels\.invalid: /);
});

test("canReceive decides recipients by handle kind, or by namespace prefix when the channel declares one", () => {
    assert.equal(canReceive(descriptorOf("imessage"), "phone", "+36301234567"), true);
    assert.equal(canReceive(descriptorOf("imessage"), "email", "a@b.co"), true);
    assert.equal(canReceive(descriptorOf("imessage"), "whatsapp", "+36301234567@wa"), false);
    assert.equal(canReceive(descriptorOf("email"), "phone", "+36301234567"), false);
    assert.equal(canReceive(descriptorOf("email"), "email", "a@b.co"), true);
    assert.equal(canReceive(descriptorOf("whatsapp"), "whatsapp", "+36301234567@wa"), true);
    assert.equal(canReceive(descriptorOf("whatsapp"), "other", "group:abc"), false);
    const tg = { ...good(), recipient: { kinds: ["other"], prefix: "other:tg:" } };
    assert.equal(canReceive(tg, "other", "other:tg:123"), true);
    assert.equal(canReceive(tg, "other", "other:bpr:signal:1"), false);
    assert.equal(canReceive(tg, "phone", "other:tg:123"), true, "the prefix decides, not the kind");
});

test("HTTP: GET /api/channels lists the channels with enabled and send flags, validates against the schema, revalidates by ETag", async (t) => {
    const connectors = new Set(["imessage", "apple-mail"]);
    const registry = { get: (id) => (connectors.has(id) ? { id } : null) };
    const sender = { capability: (id) => (id === CH.whatsapp ? { available: false, reason: "Sending through this channel is not available." } : { available: true }) };
    const { app, port } = await startServer({ deps: { registry, sender } });
    t.after(() => app.close());
    const get = (p, h = {}) => request(port, { path: p, headers: { host: `127.0.0.1:${port}`, ...h } });
    const r = await get("/api/channels");
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.items.map((c) => [c.id, c.enabled, c.sendAvailable, c.sendReason]), [
        ["imessage", true, true, null], ["email", true, true, null], ["whatsapp", false, false, "Sending through this channel is not available."],
    ]);
    assert.equal(r.json.items[0].label, "iMessage");
    assert.deepEqual(r.json.items[2].capabilities, { read: true, send: true, handoff: true, files: false });
    assert.match(r.headers.etag, /^W\/"/);
    assert.equal(r.headers["cache-control"], "no-cache");
    const schema = JSON.parse(readFileSync(new URL("../schema/api-read.json", import.meta.url), "utf8"));
    const ajv = new Ajv({ strict: false });
    ajv.addSchema(schema);
    const valid = ajv.getSchema(`${schema.$id}#/definitions/ChannelList`);
    assert.ok(valid(r.json), JSON.stringify(valid.errors));
    assert.equal((await get("/api/channels", { "if-none-match": r.headers.etag })).status, 304);
    const q = await get("/api/channels?x=1");
    assert.deepEqual([q.status, q.json.error.code], [400, "invalid_request"]);
    connectors.add("whatsapp");
    assert.equal((await get("/api/channels")).json.items[2].enabled, true, "enabled follows the connector registry");
    assert.equal((await request(port, { path: "/api/channels", headers: { host: "evil.example" } })).status, 403, "the Host guard applies");
});

// A channel is defined in the registry and nowhere else: the code that is not about one specific channel must not name one.
test("no channel id literal outside the registry, the migrations and the channel implementations", () => {
    const root = path.resolve("src");
    const walk = (d) => readdirSync(d).flatMap((f) => (statSync(path.join(d, f)).isDirectory() ? walk(path.join(d, f)) : [path.join(d, f)]));
    // implementations of one channel (connectors, drivers, handle parsing, wording catalogs, one-off tools) legitimately name it
    const IMPLEMENTATIONS = [/^connectors\//, /^storage\/migrations\//, /^channels\/registry\.js$/, /^send\/drivers\.js$/, /^status\/recovery\.js$/, /^identity\/normalize\.js$/, /^ops\/userstate\.js$/, /^cli\/accounts\.js$/, /^drafting\/service\.js$/];
    const LITERAL = /(["'`])(imessage|email|whatsapp)\1/;
    const found = [];
    for (const file of walk(root).filter((f) => f.endsWith(".js"))) {
        const rel = path.relative(root, file);
        if (IMPLEMENTATIONS.some((re) => re.test(rel))) continue;
        readFileSync(file, "utf8").split("\n").forEach((line, i) => {
            if (LITERAL.test(line) && !/channel-literal-ok:\s*\S/.test(line)) found.push(`src/${rel}:${i + 1}: ${line.trim().slice(0, 90)}`);
        });
    }
    assert.deepEqual(found, [], "use CH.<id> or the descriptor, or mark the line with `// channel-literal-ok: <reason>`");
});
