import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
const imports = (src: string) => [...src.matchAll(/^import\s.*?from\s+"([^"]+)"|^import\s+"([^"]+)"/gm)].map((m) => m[1] ?? m[2]);

describe("design system bootstrap", () => {
  it("imports the GDS stylesheet exactly once, before any other import", () => {
    const list = imports(read("./main.tsx"));
    expect(list[0]).toBe("@sovereignsquad/gds-theme/styles.css");
    expect(list.filter((i) => i.endsWith("styles.css"))).toHaveLength(1);
  });

  it("wraps the app in exactly one GdsProvider and no Mantine provider", () => {
    const src = read("./main.tsx");
    expect(src.match(/<GdsProvider/g)).toHaveLength(1);
    expect(src).not.toMatch(/MantineProvider|@mantine\//);
  });

  it("never imports Mantine directly anywhere in the app", () => {
    // the lint rule enforces this too; this keeps the check visible next to the bootstrap rules
    const files = import.meta.glob("./**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
    for (const [file, src] of Object.entries(files)) expect(src, file).not.toMatch(/from\s+"@mantine\//);
  });
});
