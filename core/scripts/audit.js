// Repository audit: what a reviewer checks before a project is published. Run: node scripts/audit.js
// Fails (exit 1) on any finding. Part of `npm run verify:release`.
//   1. the files a public project needs exist
//   2. no personal data or database files are tracked, no secrets in tracked text
//   3. every relative Markdown link points at something that exists; no absolute paths of this machine
//   4. no obsolete wording in Reply Core's code and docs (the phrases below)
//   5. the changelog, package versions and migration list agree with each other
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const root = process.env.AUDIT_ROOT ? path.resolve(process.env.AUDIT_ROOT) : path.resolve(import.meta.dirname, "..", ".."); // AUDIT_ROOT: tests point it at a throwaway repository
const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, maxBuffer: 1 << 28 }).toString().split("\0").filter(Boolean).filter((f) => existsSync(path.join(root, f)));
const findings = [];
const fail = (check, msg) => findings.push(`${check}: ${msg}`);
const read = (f) => readFileSync(path.join(root, f), "utf8");
const isText = (f) => !/\.(png|jpg|jpeg|gif|ico|icns|pdf|woff2?|ttf|otf|zip|gz|lance|arrow|bin|db|sqlite|svg|webp|mp4|mov)$/i.test(f);

// 1. required files
for (const f of ["README.md", "LICENSE", "SECURITY.md", "CHANGELOG.md", "CONTRIBUTING.md", "docs/README.md", "docs/KNOWN_ISSUES.md", "docs/USER_GUIDE.md", "docs/TECH_DESIGN.md", "docs/DESIGN_SYSTEM.md", "docs/CORE_ARCHITECTURE.md", ".github/workflows/ci.yml"]) {
    if (!existsSync(path.join(root, f))) fail("missing-file", f);
}

// 2. personal data and secrets
const DENY = [/\.(db|db-shm|db-wal|sqlite|sqlite3|lance)$/i, /(^|\/)(training_data|feedback)\.jsonl$/, /(^|\/)\.env$/, /(^|\/)contacts\.json(\.bak)?$/, /\.(pem|p12|key)$/i, /(^|\/)[^/]*\.log$/];
for (const f of tracked) if (DENY.some((re) => re.test(f))) fail("personal-or-secret-file-tracked", f);
const SECRET = [/ghp_[A-Za-z0-9]{20,}/, /github_pat_[A-Za-z0-9_]{20,}/, /sk-[A-Za-z0-9]{32,}/, /AKIA[0-9A-Z]{16}/, /-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----/, /xox[baprs]-[A-Za-z0-9-]{10,}/, /AIza[0-9A-Za-z_-]{30,}/];
for (const f of tracked) {
    if (!isText(f)) continue;
    let text;
    try { text = read(f); } catch { continue; }
    if (text.length > 5_000_000) continue;
    for (const re of SECRET) if (re.test(text)) fail("secret-in-file", `${f} matches ${re}`);
}

// 3. Markdown links
const md = tracked.filter((f) => f.endsWith(".md") && !f.includes("node_modules/"));
for (const f of md) {
    const text = read(f).replace(/```[\s\S]*?```/g, ""); // links inside code fences are examples
    for (const m of text.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
        const target = m[1];
        if (/^(https?:|mailto:|#|tel:)/.test(target)) continue;
        if (target.startsWith("/Users/") || target.startsWith("file:")) { fail("absolute-path-link", `${f} -> ${target}`); continue; }
        const rel = decodeURIComponent(target.split("#")[0]);
        if (!rel) continue;
        if (!existsSync(path.join(root, path.dirname(f), rel))) fail("broken-link", `${f} -> ${target}`);
    }
}

// 4. obsolete wording in Reply Core's own code and docs
const OBSOLETE = [
    [/never sends (a message|anything)|Reply Core never sends|there is no send code/i, "Reply Core can send now (docs/CORE_SENDING.md)"],
    [/arrives with issue|owned by issue|living document, owned|first user\.|later issues add|each (screen|connector) issue adds/i, "issue-by-issue workflow wording"],
    [/until a screen lands|is not built yet|coming soon/i, "placeholder wording"],
    [/\bTODO\b|\bFIXME\b/, "unfinished work marker"],
];
const own = tracked.filter((f) => (f.startsWith("core/") || f.startsWith("docs/") || f === "README.md" || f === "CHANGELOG.md") && isText(f) && !f.startsWith("core/ui/src/api/types.gen.ts") && !f.startsWith("core/test/") && f !== "core/scripts/audit.js" && !f.endsWith("package-lock.json") && !f.startsWith("core/helper/.build"));
for (const f of own) {
    const lines = read(f).split("\n");
    lines.forEach((line, i) => { for (const [re, why] of OBSOLETE) if (re.test(line)) fail("obsolete-wording", `${f}:${i + 1} ${why}: ${line.trim().slice(0, 80)}`); });
}

// 5. consistency
const pkg = JSON.parse(read("core/package.json"));
const uiPkg = JSON.parse(read("core/ui/package.json"));
if (pkg.version !== uiPkg.version) fail("version", `core ${pkg.version} and ui ${uiPkg.version} differ`);
if (existsSync(path.join(root, "CHANGELOG.md"))) {
    const top = /^## \[(\d+\.\d+\.\d+)\]/m.exec(read("CHANGELOG.md"))?.[1];
    if (top !== pkg.version) fail("version", `CHANGELOG's newest release is ${top}, package.json says ${pkg.version}`);
}
const migrations = readdirSync(path.join(root, "core/src/storage/migrations")).filter((f) => f.endsWith(".sql")).map((f) => f.slice(0, 4));
if (existsSync(path.join(root, "docs/CORE_DATA_MODEL.md"))) {
    const model = read("docs/CORE_DATA_MODEL.md");
    for (const n of migrations) if (!model.includes(n)) fail("docs-out-of-date", `docs/CORE_DATA_MODEL.md does not mention migration ${n}`);
}

if (findings.length) {
    console.error(`audit: ${findings.length} finding${findings.length === 1 ? "" : "s"}`);
    for (const f of findings.slice(0, 200)) console.error(`  ${f}`);
    if (findings.length > 200) console.error(`  ... and ${findings.length - 200} more`);
    process.exit(1);
}
console.log(`audit: ok (${tracked.length} files, ${md.length} Markdown files)`);
