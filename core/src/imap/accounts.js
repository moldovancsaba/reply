import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

// IMAP accounts live in REPLY_CORE_HOME/imap-accounts.json (mode 0600). The file holds NO secret: passwords are in the
// macOS keychain under the account id.
export const FILE = "imap-accounts.json";

export class AccountError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}

export const accountId = (user, host) => `${user.trim().toLowerCase()}@${host.trim().toLowerCase()}`;

export function validate(a) {
    const bad = (m) => { throw new AccountError("invalid_account", m); };
    if (!a || typeof a !== "object") bad("account must be an object");
    if (typeof a.host !== "string" || !/^[a-z0-9.-]+$/i.test(a.host)) bad("host must be a hostname");
    if (!Number.isInteger(a.port) || a.port < 1 || a.port > 65535) bad("port must be 1-65535");
    if (a.port === 143) bad("port 143 is plaintext IMAP; Reply Core only connects with TLS (use 993)");
    if (typeof a.user !== "string" || !a.user.trim()) bad("user is required");
    if (typeof a.label !== "string") bad("label must be text");
    return a;
}

export function loadAccounts(home) {
    const file = path.join(home, FILE);
    if (!existsSync(file)) return [];
    let list;
    try {
        list = JSON.parse(readFileSync(file, "utf8"));
    } catch {
        throw new AccountError("accounts_unreadable", `${FILE} is not valid JSON; fix or remove it`);
    }
    if (!Array.isArray(list)) throw new AccountError("accounts_unreadable", `${FILE} must contain a list`);
    return list;
}

export function saveAccounts(home, list) {
    const file = path.join(home, FILE);
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(list, null, 2)}\n`, { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, file);
}

export function addAccount(home, account) {
    validate(account);
    const list = loadAccounts(home).filter((a) => a.id !== account.id);
    list.push(account);
    saveAccounts(home, list);
}

export function removeAccount(home, id) {
    const list = loadAccounts(home);
    const rest = list.filter((a) => a.id !== id);
    if (rest.length === list.length) return false;
    saveAccounts(home, rest);
    return true;
}

export const hasAccounts = (home) => { try { return loadAccounts(home).length > 0; } catch { return false; } };
