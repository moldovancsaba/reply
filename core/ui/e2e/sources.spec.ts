import { expect, test, type Page, type Route } from "@playwright/test";
import { expectAccessible, expectAccessibleNow } from "./a11y";
import { startService, type Service } from "./service";

let svc: Service;
test.beforeAll(async () => { svc = await startService(); });
test.afterAll(async () => { await svc.stop(); });

const json = (r: Route, body: unknown, status = 200) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const FDA = "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles";

type Conn = Record<string, unknown>;
const report = (connectors: Conn[], over: Record<string, unknown> = {}) => ({
  overall: "ok", storage: { state: "ok", version: 7, dbBytes: 1 }, helper: { state: "ok", version: "1" }, connectors,
  backups: { count: 0, totalBytes: 0 }, metrics: { runs: 0, failuresByCode: {}, lastDurationMs: null }, generatedAt: iso(0), ...over,
});
const OK: Conn = { id: "contacts", label: "Contacts", state: "ok", message: "", messagesTotal: 1200, lastSuccessAt: iso(5 * 60_000), nextRunAt: new Date(Date.now() + 600_000).toISOString() };
const BLOCKED: Conn = { id: "imessage", label: "iMessage", state: "blocked", code: "permission_denied", message: "Reply Core cannot read your Messages.", messagesTotal: 0, recovery: [
  { order: 2, text: "Switch Reply Core on.", deepLink: "javascript:alert(1)" },
  { order: 1, text: "Open Full Disk Access in System Settings.", deepLink: FDA },
] };
const status = (p: Page, get: () => unknown, st = 200) => p.route("**/api/status", (r) => json(r, get(), st));

test("each state shows words, an icon-badge and one action; blocked shows ordered steps with only allowed links", async ({ page }) => {
  await status(page, () => report([
    OK,
    BLOCKED,
    { id: "apple-mail", label: "Email (Apple Mail)", state: "error", message: "Mail was busy.", messagesTotal: 10, retryAt: new Date(Date.now() + 120_000).toISOString() },
    { id: "whatsapp", label: "WhatsApp", state: "never_synced", message: "", messagesTotal: 0 },
    { id: "imap", label: "IMAP", state: "syncing", message: "", messagesTotal: 500, messagesThisRun: 12400, accounts: [{ account: "a@example.com", state: "ok", message: "", messagesTotal: 500 }] },
  ]));
  await page.goto(`${svc.url}/sources`);
  await expect(page.getByText("2 of 5 sources need attention.")).toBeVisible();
  const panel = (name: string) => page.locator("section, div").filter({ has: page.getByRole("heading", { name, exact: true }) }).last();
  await expect(page.getByText("Connected").first()).toBeVisible();
  await expect(page.getByText("Needs your attention")).toBeVisible();
  await expect(page.getByText("Problem, will retry")).toBeVisible();
  await expect(page.getByText("Not synced yet")).toBeVisible();
  await expect(page.getByText("Imported 12,400 messages so far")).toBeVisible();
  const steps = page.getByRole("list", { name: "What to do" }).getByRole("listitem");
  await expect(steps).toHaveCount(2);
  await expect(steps.nth(0)).toContainText("Open Full Disk Access in System Settings.");
  await expect(steps.nth(0).getByRole("link", { name: "Open Full Disk Access settings" })).toHaveAttribute("href", FDA);
  await expect(steps.nth(1).getByRole("link")).toHaveCount(0);
  await expect(page.getByText(/Next attempt/)).toBeVisible();
  await expect(page.getByRole("list", { name: "IMAP accounts" })).toContainText("a@example.com");
  await expect(page.getByRole("button", { name: "Syncing…" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Recheck", exact: true })).toBeVisible();
  void panel;
  await expectAccessibleNow(page, "sources states");
});

test("Recheck clears a fixed block and says so politely", async ({ page }) => {
  let fixed = false;
  await status(page, () => report([fixed ? { ...BLOCKED, state: "ok", message: "", messagesTotal: 3, recovery: undefined } : BLOCKED]));
  await page.route("**/api/status/recheck", (r) => { fixed = true; return json(r, report([{ ...BLOCKED, state: "ok", message: "", messagesTotal: 3, recovery: undefined }])); });
  await page.goto(`${svc.url}/sources`);
  await page.getByRole("button", { name: "Recheck", exact: true }).click();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "iMessage is connected." })).toHaveCount(1);
  await expect(page.getByRole("list", { name: "What to do" })).toHaveCount(0);
});

test("Sync now starts a run and shows progress; already_running is not an error; blocked explains", async ({ page }) => {
  let state = "ok";
  let reply: { status: number; body: unknown } = { status: 202, body: { accepted: true, runId: "r1", state: "running" } };
  const posts: string[] = [];
  await status(page, () => report([{ ...OK, state, messagesThisRun: state === "syncing" ? 40 : undefined }]));
  await page.route(/\/api\/sync\//, (r) => { posts.push(r.request().url()); if (reply.status === 202) state = "syncing"; return json(r, reply.body, reply.status); });
  await page.goto(`${svc.url}/sources`);
  await page.getByRole("button", { name: "Sync now" }).click();
  await expect(page.getByText("Imported 40 messages so far")).toBeVisible();
  await expect(page.getByRole("button", { name: "Syncing…" })).toBeDisabled();
  expect(posts).toHaveLength(1);

  state = "ok";
  reply = { status: 409, body: { error: { code: "already_running", message: "Already running.", requestId: "r", retryable: false } } };
  await page.reload();
  await page.getByRole("button", { name: "Sync now" }).click();
  await page.waitForTimeout(500);
  await expect(page.getByRole("alert")).toHaveCount(0);

  reply = { status: 423, body: { error: { code: "blocked", message: "Not allowed yet.", requestId: "r", retryable: false } } };
  await page.getByRole("button", { name: "Sync now" }).click();
  await expect(page.getByRole("alert")).toContainText("Not allowed yet.");
});

test("storage and helper problems are a top-level alert", async ({ page }) => {
  await status(page, () => report([OK], { storage: { state: "error", version: 7, dbBytes: 0, message: "The database is damaged.", recovery: [{ order: 1, text: "Restore the latest backup." }] }, helper: { state: "missing" } }));
  await page.goto(`${svc.url}/sources`);
  await expect(page.getByRole("alert").filter({ hasText: "Storage problem" })).toContainText("The database is damaged.");
  await expect(page.getByRole("alert").filter({ hasText: "The macOS helper is missing" })).toBeVisible();
  await expect(page.getByText("Restore the latest backup.")).toBeVisible();
});

test("status unreachable shows an error with Try again; no sources shows guidance (real service)", async ({ page }) => {
  let fail = true;
  await page.route("**/api/status", (r) => fail ? json(r, { error: { code: "status_unavailable", message: "Status is not available.", requestId: "r", retryable: true } }, 500) : r.fallback());
  await page.goto(`${svc.url}/sources`);
  await expect(page.getByText("Sources could not be checked")).toBeVisible({ timeout: 10_000 });
  fail = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "No sources are enabled" })).toBeVisible();
});

test("first run: /inbox leads to Sources once when no source works; not when one is ok", async ({ page }) => {
  await status(page, () => report([BLOCKED, { id: "whatsapp", label: "WhatsApp", state: "never_synced", message: "", messagesTotal: 0 }]));
  await page.goto(`${svc.url}/inbox`);
  await expect(page).toHaveURL(/\/sources$/);
  await expect(page.getByText("Connect a source to get started")).toBeVisible();
  await page.locator("nav a[href='/inbox']").click();
  await expect(page).toHaveURL(/\/inbox$/);
  await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();
  await page.unroute("**/api/status");
  await status(page, () => report([OK, BLOCKED]));
  await page.goto(`${svc.url}/inbox`);
  await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();
  await page.waitForTimeout(800);
  await expect(page).toHaveURL(/\/inbox$/);
  await page.goto(`${svc.url}/sources`);
  await expect(page.getByText("Connect a source to get started")).toHaveCount(0);
});

test("polling: every 3 s while syncing, every 30 s otherwise", async ({ page }) => {
  let syncing = true;
  let calls = 0;
  await page.clock.install();
  await page.route("**/api/status", (r) => { calls += 1; return json(r, report([{ ...OK, state: syncing ? "syncing" : "ok", messagesThisRun: 1 }])); });
  await page.goto(`${svc.url}/sources`);
  await expect(page.getByText("Imported 1 messages so far")).toBeVisible();
  const base = calls;
  for (let i = 0; i < 4; i++) { await page.clock.runFor(3000); await page.waitForTimeout(150); } // let each answer arrive before the next tick (WebKit needs it)
  await expect.poll(() => calls - base).toBeGreaterThanOrEqual(3);
  syncing = false;
  await page.clock.runFor(4000);
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  const settled = calls;
  await page.clock.runFor(25_000);
  expect(calls - settled, "no fast polling once nothing syncs").toBeLessThanOrEqual(1);
});

test("keyboard only: Tab reaches Recheck and Enter activates it", async ({ page, browserName }) => {
  let rechecked = false;
  await status(page, () => report([BLOCKED]));
  await page.route("**/api/status/recheck", (r) => { rechecked = true; return json(r, report([BLOCKED])); });
  await page.goto(`${svc.url}/sources`);
  const btn = page.getByRole("button", { name: "Recheck", exact: true });
  for (let i = 0; i < 30 && !(await btn.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab"); // Safari tabs to every control only with Option held
  await expect(btn).toBeFocused();
  await page.keyboard.press("Enter");
  await expect.poll(() => rechecked).toBe(true);
});

test("a11y gate: states in light and dark, and at 375 px", async ({ page }) => {
  await status(page, () => report([OK, BLOCKED, { id: "whatsapp", label: "WhatsApp", state: "never_synced", message: "", messagesTotal: 0 }, { id: "imap", label: "IMAP", state: "syncing", message: "", messagesTotal: 5, messagesThisRun: 3 }]));
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `${svc.url}/sources`);
    await expect(page.getByText("Needs your attention")).toBeVisible();
  }
  await page.setViewportSize({ width: 375, height: 800 });
  await expectAccessible(page, `${svc.url}/sources`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("Sources offers Allow for sending, and for Contacts when it is blocked", async ({ page }) => {
  const asked: unknown[] = [];
  await page.route("**/api/consent", (r) => { asked.push(r.request().postDataJSON()); return json(r, { opened: true }, 202); });
  await status(page, () => report([{ id: "contacts", label: "Contacts", state: "blocked", code: "permission_denied", message: "Reply Core cannot read your Contacts.", messagesTotal: 0 }]));
  await page.goto(`${svc.url}/sources`);
  await page.getByRole("button", { name: "Allow {reply} to read Contacts" }).click();
  await page.getByRole("button", { name: "Allow {reply} to send" }).click();
  await expect.poll(() => asked).toEqual([{ kind: "contacts" }, { kind: "sending" }]);
  await expectAccessibleNow(page, "sources allow");
});
