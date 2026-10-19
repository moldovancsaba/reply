import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const freePort = () => new Promise<number>((resolve) => { const s = net.createServer().listen(0, "127.0.0.1", () => { const { port } = s.address() as net.AddressInfo; s.close(() => resolve(port)); }); });

export type Service = { url: string; port: number; stop: () => Promise<void>; start: () => Promise<void>; running: () => boolean };

// A real Reply Core service (serving the built UI) on its own port and data folder.
export async function startService({ seed = false, env = {} }: { seed?: boolean; env?: Record<string, string> } = {}): Promise<Service> {
  const port = await freePort();
  const home = mkdtempSync(path.join(os.tmpdir(), "rc-e2e-"));
  if (seed) {
    const r = spawnSync(process.execPath, [path.join(root, "ui", "e2e", "seed.mjs"), home], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`seed failed: ${r.stderr}`);
  }
  let child: ChildProcess | null = null;
  const start = async () => {
    child = spawn(process.execPath, [path.join(root, "src", "index.js")], {
      env: { ...process.env, REPLY_CORE_HOME: home, REPLY_CORE_PORT: String(port), REPLY_CORE_CONNECTORS: "none", REPLY_CORE_LOG_LEVEL: "error", ...env },
      stdio: ["ignore", "pipe", "inherit"],
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("service did not start")), 10_000);
      child!.stdout!.on("data", (d: Buffer) => { if (String(d).includes("listening")) { clearTimeout(timer); resolve(); } });
      child!.on("exit", (code: number | null) => reject(new Error(`service exited early (${code})`)));
    });
    child.removeAllListeners("exit");
  };
  const stop = async () => {
    if (!child) return;
    const c = child;
    child = null;
    c.kill("SIGTERM");
    await new Promise((resolve) => c.on("exit", resolve));
  };
  await start();
  return { url: `http://127.0.0.1:${port}`, port, start, stop, running: () => child !== null };
}
