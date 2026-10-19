import { closeSync, existsSync, mkdirSync, openSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import path from "node:path";

export const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
export const DEFAULT_KEEP = 5;

// A size-rotated log file for pino: service.log, service.log.1 ... service.log.<keep-1> (the oldest is deleted), so the
// total stays under keep x maxBytes. Writes are small synchronous appends and a rotation is a few renames, so it never
// blocks for long; any failure falls back to stderr once instead of throwing into the logger.
export function createRotatingStream({ file, maxBytes = DEFAULT_MAX_BYTES, keep = DEFAULT_KEEP }) {
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    let fd = openSync(file, "a", 0o600);
    let size = existsSync(file) ? statSync(file).size : 0;
    let failed = false;

    const rotate = () => {
        closeSync(fd);
        rmSync(`${file}.${keep - 1}`, { force: true });
        for (let i = keep - 2; i >= 1; i--) if (existsSync(`${file}.${i}`)) renameSync(`${file}.${i}`, `${file}.${i + 1}`);
        renameSync(file, `${file}.1`);
        fd = openSync(file, "a", 0o600);
        size = 0;
    };

    return {
        write(chunk) {
            try {
                const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
                if (size > 0 && size + buf.length > maxBytes) rotate();
                writeSync(fd, buf);
                size += buf.length;
            } catch (err) {
                if (!failed) { failed = true; process.stderr.write(`reply-core: cannot write the log file (${err.code ?? err.message}); logging to stderr\n`); }
                process.stderr.write(chunk);
            }
        },
        end() { try { closeSync(fd); } catch { /* already closed */ } },
    };
}
