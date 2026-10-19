// The one place that words problems for the operator: what happened, and the ordered steps to fix it. The status API
// serves these; the UI and the docs show them verbatim. Plain language, one concrete action per step.
const FDA = "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles";
const CONTACTS = "x-apple.systempreferences:com.apple.preference.security?Privacy_Contacts";

export const LABELS = { imessage: "iMessage", "apple-mail": "Email (Apple Mail)", contacts: "Contacts", whatsapp: "WhatsApp", imap: "Email (IMAP)", stub: "Demo source" };

export const STATE_MESSAGES = {
    never_synced: "Not synced yet.",
    syncing: "Importing now.",
    ok: "Up to date.",
};

const fdaSteps = (what) => [
    { order: 1, text: `Open System Settings > Privacy & Security > Full Disk Access.`, deepLink: FDA },
    { order: 2, text: `Turn on the app that starts Reply Core, so it can read ${what}.` },
    { order: 3, text: "Quit and reopen that app, then choose Recheck." },
];

// Default wording per error code; `byConnector` overrides where the cause differs.
export const CATALOG = {
    default: {
        permission_denied: { message: "Reply Core is not allowed to read this source.", recovery: fdaSteps("it") },
        source_missing: { message: "This source was not found on this Mac.", recovery: [{ order: 1, text: "Open the app this source comes from and set it up, then choose Recheck." }] },
        source_locked: { message: "The source is busy. Reply Core will try again shortly.", recovery: [{ order: 1, text: "Nothing to do unless this keeps happening. Close the app and choose Recheck if it does." }] },
        schema_unsupported: { message: "The app changed how it stores data, so Reply Core stopped reading it to avoid wrong results.", recovery: [{ order: 1, text: "Check for a Reply Core update that supports this version of the app." }] },
        helper_unavailable: { message: "The Reply Core helper is missing or was changed.", recovery: [{ order: 1, text: "Run core/helper/build.sh to build the helper, then choose Recheck." }] },
        timeout: { message: "The source took too long to answer. Reply Core will try again.", recovery: [{ order: 1, text: "Nothing to do unless this keeps happening. Restart the source app and choose Recheck if it does." }] },
        network_unavailable: { message: "The connection failed. Reply Core will try again.", recovery: [{ order: 1, text: "Check your internet connection." }, { order: 2, text: "Choose Sync now to try immediately." }] },
        auth_failed: { message: "The account refused the sign-in.", recovery: [{ order: 1, text: "Create a new app password for the account at your email provider." }, { order: 2, text: "Run reply-core accounts add-imap again with the new password, then choose Recheck." }] },
        internal: { message: "Something unexpected went wrong. Reply Core will try again.", recovery: [{ order: 1, text: "Choose Sync now. If it fails again, look at the service log for the request id." }] },
    },
    byConnector: {
        imessage: {
            permission_denied: { message: "Reply Core cannot read your Messages.", recovery: fdaSteps("your Messages") },
            source_missing: { message: "Messages has no data on this Mac yet.", recovery: [{ order: 1, text: "Open the Messages app and sign in, then choose Recheck." }] },
        },
        "apple-mail": {
            permission_denied: { message: "Reply Core cannot read your Mail.", recovery: fdaSteps("your Mail") },
            source_missing: { message: "Apple Mail has no accounts on this Mac.", recovery: [{ order: 1, text: "Open the Mail app and add an account, then choose Recheck." }] },
        },
        contacts: {
            permission_denied: {
                message: "Reply Core is not allowed to read your Contacts.",
                recovery: [
                    { order: 1, text: "Open System Settings > Privacy & Security > Contacts.", deepLink: CONTACTS },
                    { order: 2, text: "Turn on the app that starts Reply Core." },
                    { order: 3, text: "Choose Recheck." },
                ],
            },
        },
        whatsapp: {
            permission_denied: { message: "Reply Core cannot read WhatsApp.", recovery: fdaSteps("WhatsApp") },
            source_missing: { message: "WhatsApp Desktop has no data on this Mac.", recovery: [{ order: 1, text: "Install WhatsApp Desktop and link your phone, then choose Recheck." }] },
        },
    },
    storage: {
        storage_corrupt: { message: "The Reply Core database is damaged.", recovery: [{ order: 1, text: "Stop Reply Core." }, { order: 2, text: "Restore a backup with reply-core restore, or delete core.db and let Reply Core import everything again." }] },
        storage_unavailable: { message: "The Reply Core database cannot be opened.", recovery: [{ order: 1, text: "Check that the data folder exists and is writable, then restart Reply Core." }] },
    },
};

export function describe(code, connectorId) {
    return CATALOG.byConnector[connectorId]?.[code] ?? CATALOG.default[code] ?? CATALOG.default.internal;
}
