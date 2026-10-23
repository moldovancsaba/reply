// The one place that defines what a channel is (#288). Every module that needs a channel's id, label, capabilities or recipient
// rule asks this registry; nothing else lists channels. Adding a channel means adding one descriptor here (plus its connector and
// driver). The list is static: it is compiled into the service, not loaded from disk.

const ID = /^[a-z][a-z0-9_-]{0,31}$/; // the same shape the database enforces (migration 0014)

export const DESCRIPTORS = Object.freeze([
    {
        id: "imessage", label: "iMessage", appLabel: "Messages", order: 10, icon: "message", connector: "imessage",
        recipient: { kinds: ["phone", "email"] },
        capabilities: { read: true, send: true, handoff: true, files: true },
        handoffNote: "Opens Messages with your text. Reply Core does not send it.", sentNote: "Sent through Messages.",
        handoffUrl: "imessage", deliveryCheck: "driver",
    },
    {
        id: "email", label: "Email", appLabel: "Mail", order: 20, icon: "mail", connector: "apple-mail", readers: ["apple-mail", "imap"],
        recipient: { kinds: ["email"] },
        capabilities: { read: true, send: true, handoff: true, files: true },
        handoffNote: "Opens Mail with your text. Reply Core does not send it.", sentNote: "Sent through Mail.",
        handoffUrl: "email", deliveryCheck: "driver",
    },
    {
        id: "whatsapp", label: "WhatsApp", appLabel: "WhatsApp", order: 30, icon: "phone", connector: "whatsapp",
        recipient: { kinds: ["whatsapp"] },
        capabilities: { read: true, send: true, handoff: true, files: false },
        handoffNote: "Opens WhatsApp with your text. Reply Core does not send it.", sentNote: "Sent through WhatsApp.",
        handoffUrl: "whatsapp", deliveryCheck: "external", // a key press cannot say whether anything was sent: the message must be found in WhatsApp's data
    },
]);

const URL_BUILDERS = ["imessage", "email", "whatsapp", "none"];

// Throws a plain Error naming the descriptor and the rule: a malformed registry must stop the service at start.
export function validateRegistry(list = DESCRIPTORS) {
    const ids = new Set();
    const orders = new Set();
    for (const d of list) {
        const bad = (rule) => { throw new Error(`channels.invalid: ${d?.id ?? "?"}: ${rule}`); };
        if (!d || typeof d.id !== "string" || !ID.test(d.id)) bad("id must match [a-z][a-z0-9_-]{0,31}");
        if (ids.has(d.id)) bad("duplicate id");
        if (!Number.isInteger(d.order) || orders.has(d.order)) bad(`order must be a unique integer (duplicate: ${d.order})`);
        if (!d.label || !d.appLabel) bad("label and appLabel are required");
        if (!d.icon) bad("icon is required");
        if (!d.connector) bad("connector (the id of the connector that reads this channel) is required");
        const c = d.capabilities;
        if (!c || ["read", "send", "handoff", "files"].some((k) => typeof c[k] !== "boolean")) bad("capabilities needs boolean read, send, handoff and files");
        if (!d.recipient || !Array.isArray(d.recipient.kinds) || d.recipient.kinds.length === 0) bad("recipient.kinds must list at least one handle kind");
        if (!d.handoffNote || !d.sentNote) bad("handoffNote and sentNote are required");
        if (!URL_BUILDERS.includes(d.handoffUrl)) bad(`handoffUrl must be one of ${URL_BUILDERS.join(", ")}`);
        if (!["driver", "external"].includes(d.deliveryCheck)) bad("deliveryCheck must be driver or external");
        ids.add(d.id);
        orders.add(d.order);
    }
    return list;
}
validateRegistry();

const byId = new Map(DESCRIPTORS.map((d) => [d.id, d]));

export const channelIds = () => DESCRIPTORS.map((d) => d.id);
export const isChannel = (id) => byId.has(id);
export const descriptorOf = (id) => byId.get(id) ?? null;
export const ordered = () => [...DESCRIPTORS].sort((a, b) => a.order - b.order);

// Named constants for code that must refer to a specific channel (a driver, a connector, a rule that is about one channel only).
// Use these instead of string literals: a scan test keeps literals out of the channel-agnostic code.
export const CH = Object.freeze(Object.fromEntries(DESCRIPTORS.map((d) => [d.id, d.id])));

// Which stored handles can receive on a channel: by kind, and optionally by a namespace prefix (chat networks, later).
export function canReceive(d, kind, handle) {
    if (d.recipient.prefix) return handle.startsWith(d.recipient.prefix);
    return d.recipient.kinds.includes(kind);
}
