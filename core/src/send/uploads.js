import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { AppError } from "../errors.js";

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_FILES = 5;
export const MAX_TOTAL_BYTES = 25 * 1024 * 1024;
const TTL_MS = 60 * 60 * 1000;

// What the recipient sees as the file name: no folders, no control characters, bounded.
export const cleanName = (raw) => {
    const base = String(raw ?? "").split(/[\\/]/).pop().split("").filter((c) => c.charCodeAt(0) > 31 && c.charCodeAt(0) !== 127).join("").replace(/^\.+/, "").trim().slice(0, 100);
    return base || "file";
};

// Files picked in the Reply box wait here (<home>/outbox, owner only) until they are sent, removed, or an hour has passed.
// The send request names them by id, never by path, so a request cannot make the service read any other file.
export function createUploads({ home, now = () => Date.now() }) {
    const dir = path.join(home, "outbox");
    const files = new Map(); // id -> { path, name, size, ts }

    const drop = (id) => { const f = files.get(id); if (f) { rmSync(path.dirname(f.path), { recursive: true, force: true }); files.delete(id); } };
    const sweep = () => { for (const [id, f] of files) if (now() - f.ts > TTL_MS) drop(id); };

    // a crash or restart forgets the map: whatever is left on disk from before is removed
    rmSync(dir, { recursive: true, force: true });

    function add(name, data) {
        sweep();
        if (!Buffer.isBuffer(data) || data.length === 0) throw new AppError(400, "invalid_request", "The file is empty.");
        if (data.length > MAX_FILE_BYTES) throw new AppError(413, "file_too_large", `A file can be at most ${MAX_FILE_BYTES / 1024 / 1024} MB.`);
        if (files.size >= MAX_FILES * 4) throw new AppError(429, "too_many_uploads", "Too many files are waiting to be sent. Remove some first.");
        const id = `u_${randomUUID().slice(0, 12)}`;
        const clean = cleanName(name);
        const folder = path.join(dir, id);
        mkdirSync(folder, { recursive: true, mode: 0o700 });
        chmodSync(dir, 0o700);
        const file = path.join(folder, clean);
        writeFileSync(file, data, { mode: 0o600 });
        files.set(id, { path: file, name: clean, size: data.length, ts: now() });
        return { id, name: clean, size: data.length };
    }

    // The chosen files for a send: all must exist, at most MAX_FILES and MAX_TOTAL_BYTES together.
    function resolve(ids) {
        if (ids === undefined) return [];
        if (!Array.isArray(ids) || ids.some((i) => typeof i !== "string") || new Set(ids).size !== ids.length) throw new AppError(400, "invalid_request", "attachmentIds must be a list of distinct upload ids.");
        if (ids.length > MAX_FILES) throw new AppError(413, "too_many_attachments", `At most ${MAX_FILES} files can be sent at once.`);
        sweep();
        const list = ids.map((i) => files.get(i) ?? null);
        if (list.some((f) => !f)) throw new AppError(422, "attachment_not_found", "One of the files is no longer available. Attach it again.");
        if (list.reduce((n, f) => n + f.size, 0) > MAX_TOTAL_BYTES) throw new AppError(413, "attachments_too_large", `Together the files can be at most ${MAX_TOTAL_BYTES / 1024 / 1024} MB.`);
        return list.map(({ path: p, name, size }) => ({ path: p, name, size }));
    }

    return { add, resolve, remove: drop, release: (ids) => ids.forEach(drop), count: () => files.size, dir };
}
