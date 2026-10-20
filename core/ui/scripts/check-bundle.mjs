// Fails when the app's JavaScript grows past its budget. gzip sizes of dist/assets/*.js.
import { readdirSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const BUDGET_GZIP_KB = 250; // initial JavaScript, gzipped, shared design-system chunk included
const dir = new URL("../dist/assets/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".js"));
const sizes = files.map((f) => [f, gzipSync(readFileSync(new URL(f, dir))).length / 1024]);
const total = sizes.reduce((n, [, s]) => n + s, 0);
for (const [f, s] of sizes.sort((a, b) => b[1] - a[1])) console.log(`${s.toFixed(1).padStart(7)} KB  ${f}`);
console.log(`${total.toFixed(1).padStart(7)} KB  total (budget ${BUDGET_GZIP_KB} KB)`);
if (total > BUDGET_GZIP_KB) { console.error("bundle budget exceeded"); process.exit(1); }
