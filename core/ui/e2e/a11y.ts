import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createGdsA11yReport, createGdsA11yTest, expectGdsFocusTrap, formatGdsA11yReport, runGdsAxeScan, runGdsContrastGate } from "@sovereignsquad/gds-a11y";
import { expect, type Page } from "@playwright/test";

const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

// axe must be in the page BEFORE the scan. createGdsA11yTest navigates by itself, which discards scripts added afterwards,
// and a scan without axe silently reports nothing: so axe is added as an init script and its presence is asserted.
export async function withAxe(page: Page) {
  await page.addInitScript({ content: axeSource });
}
type GdsPage = Parameters<typeof createGdsA11yTest>[0];
const gds = (page: Page) => page as unknown as GdsPage; // Playwright's Page is structurally compatible; its stricter overload types are not
const assertAxePresent = async (page: Page) => expect(await page.evaluate(() => typeof (globalThis as { axe?: unknown }).axe), "axe-core must be loaded, otherwise the scan proves nothing").toBe("object");

// Navigates to `url` and runs the GDS gate: axe + contrast (+ keyboard order when given). Serious and critical findings fail.
export async function expectAccessible(page: Page, url: string, expectedTabOrder?: string[]) {
  await withAxe(page);
  const report = await createGdsA11yTest(gds(page), { route: url, severityThreshold: "serious", ...(expectedTabOrder ? { expectedTabOrder } : {}) });
  await assertAxePresent(page);
  expect(report.findings.filter((f) => f.status === "failure"), formatGdsA11yReport(report)).toEqual([]);
  return report;
}

// The same gate on the page exactly as it is now (after interactions), without navigating.
export async function expectAccessibleNow(page: Page, label: string) {
  await page.addScriptTag({ content: axeSource });
  await assertAxePresent(page);
  const config = { route: label, severityThreshold: "serious" as const };
  const findings = [...(await runGdsAxeScan(gds(page), config)), ...(await runGdsContrastGate(gds(page), config)).findings];
  const report = createGdsA11yReport({ ...config, findings });
  expect(report.findings.filter((f) => f.status === "failure"), formatGdsA11yReport(report)).toEqual([]);
  return report;
}

// An open dialog must trap focus (Tab never leaves it) while Escape still closes it; the GDS check.
export async function expectFocusTrapped(page: Page, containerSelector: string, label: string) {
  const result = await expectGdsFocusTrap(gds(page), containerSelector, { route: label });
  expect(result.findings.filter((f) => f.status === "failure"), JSON.stringify(result.findings)).toEqual([]);
}
