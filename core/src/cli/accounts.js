import path from "node:path";
import Database from "better-sqlite3";
import { addAccount, accountId, AccountError, loadAccounts, removeAccount, validate } from "../imap/accounts.js";
import { findSentBox, imapErrorCode, isTlsRefusal, openClient } from "../imap/client.js";
import { createRepo } from "../storage/repo.js";

// Exit codes: 0 ok, 2 usage, 3 auth failed, 4 network or TLS, 5 keychain.
export const EXIT = { ok: 0, usage: 2, auth: 3, network: 4, keychain: 5 };
const USAGE = `usage:
  reply-core accounts add-imap --host <host> [--port 993] --user <user> [--label <name>] [--password-stdin]
  reply-core accounts list
  reply-core accounts remove <id> [--purge]
The password is asked for (hidden) or read from stdin with --password-stdin; it is never an argument.`;

function parseFlags(args, valued, bool = []) {
    const out = { _: [] };
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (valued.includes(a)) {
            if (i + 1 >= args.length || args[i + 1].startsWith("--")) throw new AccountError("usage", `${a} needs a value`);
            out[a.slice(2)] = args[++i];
        } else if (bool.includes(a)) out[a.slice(2)] = true;
        else if (a.startsWith("--")) throw new AccountError("usage", `unknown option ${a}`);
        else out._.push(a);
    }
    return out;
}

// Reads one line without echoing it. Falls back to stdin when it is not a terminal (--password-stdin).
export async function readSecret({ stdin = process.stdin, stderr = process.stderr, prompt = "Password: ", fromStdin = false } = {}) {
    return new Promise((resolve, reject) => {
        const tty = stdin.isTTY && !fromStdin;
        let buf = "";
        if (tty) { stderr.write(prompt); stdin.setRawMode(true); }
        stdin.resume();
        stdin.setEncoding("utf8");
        const done = (value, err) => {
            stdin.removeListener("data", onData);
            stdin.removeListener("end", onEnd);
            if (tty) { stdin.setRawMode(false); stderr.write("\n"); }
            stdin.pause();
            err ? reject(err) : resolve(value);
        };
        const onEnd = () => done(buf.split("\n")[0].replace(/\r$/, ""));
        const onData = (chunk) => {
            for (const ch of chunk) {
                if (ch === "\u0003") return done("", new AccountError("usage", "cancelled"));
                if (ch === "\n" || ch === "\r") return done(buf);
                if (tty && (ch === "\u007f" || ch === "\b")) { buf = buf.slice(0, -1); continue; }
                buf += ch;
            }
        };
        stdin.on("data", onData);
        stdin.on("end", onEnd);
    });
}

export async function accountsCli(argv, { home, keychain, stdout = process.stdout, stderr = process.stderr, stdin = process.stdin, tls, timeouts } = {}) {
    const say = (s) => stdout.write(`${s}\n`);
    const fail = (code, s) => { stderr.write(`reply-core: ${s}\n`); return code; };
    try {
        const [cmd, ...rest] = argv;
        if (cmd === "list") {
            parseFlags(rest, []);
            for (const a of loadAccounts(home)) say(`${a.id}\t${a.host}:${a.port}\t${a.label || ""}`);
            return EXIT.ok;
        }
        if (cmd === "add-imap") {
            const f = parseFlags(rest, ["--host", "--port", "--user", "--label"], ["--password-stdin"]);
            if (f._.length) throw new AccountError("usage", `unexpected argument ${f._[0]}`);
            if (!f.host || !f.user) throw new AccountError("usage", "--host and --user are required");
            const account = { id: accountId(f.user, f.host), host: f.host.toLowerCase(), port: f.port === undefined ? 993 : Number(f.port), user: f.user, label: f.label ?? "", selfAddresses: [f.user.toLowerCase()], boxes: { inbox: "INBOX", sent: null } };
            validate(account);
            const pass = await readSecret({ stdin, stderr, fromStdin: Boolean(f["password-stdin"]) });
            if (!pass) throw new AccountError("usage", "no password given");
            const client = openClient({ host: account.host, port: account.port, user: account.user, pass }, { tls, timeouts });
            client.on("error", () => {});
            try {
                await client.connect();
                account.boxes.sent = await findSentBox(client);
                await client.logout();
            } catch (err) {
                client.close();
                const code = imapErrorCode(err);
                if (code === "auth_failed") return fail(EXIT.auth, "the server refused the login. For Gmail and iCloud create an app password first.");
                return fail(EXIT.network, isTlsRefusal(err) ? "the server's TLS certificate is not trusted, so Reply Core will not connect." : `could not reach ${account.host}:${account.port} (${err.code ?? err.message}).`);
            }
            try {
                await keychain.set(account.id, pass);
            } catch (err) {
                return fail(EXIT.keychain, `could not save the password in the keychain (${err.code ?? err.message}).`);
            }
            addAccount(home, account);
            say(`added ${account.id}${account.boxes.sent ? ` (sent folder: ${account.boxes.sent})` : " (no sent folder found)"}`);
            say("restart Reply Core to start syncing it");
            return EXIT.ok;
        }
        if (cmd === "remove") {
            const f = parseFlags(rest, [], ["--purge"]);
            if (f._.length !== 1) throw new AccountError("usage", "remove needs one account id");
            const id = f._[0];
            try {
                await keychain.delete(id);
            } catch (err) {
                return fail(EXIT.keychain, `could not remove the password from the keychain (${err.code ?? err.message}).`);
            }
            const existed = removeAccount(home, id);
            if (f.purge) {
                const db = new Database(path.join(home, "core.db"), { fileMustExist: true });
                db.pragma("busy_timeout = 5000");
                const repo = createRepo(db);
                db.transaction(() => {
                    const contacts = db.prepare("SELECT DISTINCT ch.contact_id c FROM messages m JOIN contact_handles ch ON ch.handle_norm = m.handle_norm WHERE m.channel = 'email' AND m.account = ?").all(id).map((r) => r.c);
                    const n = db.prepare("DELETE FROM messages WHERE channel = 'email' AND account = ?").run(id).changes;
                    db.prepare("DELETE FROM sync_state WHERE connector = 'imap' AND account = ?").run(id);
                    for (const c of contacts) repo.rebuildSummary(c);
                    say(`purged ${n} messages`);
                })();
                db.close();
            }
            say(existed ? `removed ${id}` : `${id} was not in the accounts file; its saved password (if any) was removed`);
            return EXIT.ok;
        }
        stderr.write(`${USAGE}\n`);
        return EXIT.usage;
    } catch (err) {
        if (err instanceof AccountError) return fail(err.code === "usage" ? EXIT.usage : EXIT.usage, err.message);
        return fail(1, err.message);
    }
}
