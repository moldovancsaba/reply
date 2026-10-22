import { expect, test, type Page } from "@playwright/test";
import { expectAccessible, expectAccessibleNow } from "./a11y";
import { startService, type Service } from "./service";

let svc: Service;
test.beforeAll(async () => { svc = await startService(); });
test.afterAll(async () => { await svc.stop(); });

const contact = { id: "c_1", displayName: "Anna Kovacs", origin: "auto", counts: { imessage: 30, email: 12, whatsapp: 0 }, countTotal: 42, handles: [] };
const msg = (i: number, over: Record<string, unknown> = {}) => ({
  id: `m${i}`, channel: i % 5 === 0 ? "email" : "imessage", isFromMe: i % 2 === 0, ts: new Date(Date.UTC(2026, 9, 1, 8, 0) + i * 3_600_000 * 5).toISOString(),
  text: `Message number ${i}`, attachments: [], counterpartHandle: "anna", ...over,
});
// newest first, like the API
const page = (from: number, to: number, next: string | null) => ({ items: Array.from({ length: to - from + 1 }, (_, k) => msg(to - k)), nextCursor: next, hasMore: next !== null });
const json = (route: import("@playwright/test").Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

// Is the element really on screen, not scrolled out of its pane? (Playwright's toBeInViewport answers 0 for elements in a
// scrolling pane in WebKit, so ask the browser what is drawn at the element's centre.)
const onScreen = (l: import("@playwright/test").Locator) => l.evaluate((el) => {
  const r = el.getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return hit !== null && el.contains(hit);
});

async function mock(p: Page, opts: { contactStatus?: number; contactBody?: unknown; messages?: (u: URL) => { status?: number; body: unknown } } = {}) {
  await p.route(/\/api\/contacts\/c_1$/, (r) => json(r, opts.contactBody ?? contact, opts.contactStatus ?? 200));
  await p.route(/\/api\/contacts\/c_1\/messages\?/, (r) => { const o = opts.messages!(new URL(r.request().url())); return json(r, o.body, o.status ?? 200); });
  await p.route(/\/api\/contacts\?/, (r) => json(r, { items: [], nextCursor: null, hasMore: false, total: 0 }));
}
const NEWEST_FIRST = (u: URL) => ({ body: u.searchParams.get("before") ? page(1, 20, null) : page(21, 70, "older") });

test("timeline: log landmark, chronological order, day headings, direction, channel and summary labels, attachments", async ({ page: p }) => {
  await mock(p, { messages: () => ({ body: { items: [
    msg(3, { channel: "email", subject: "Invoice 42", text: "Invoice 42\n\nsee attached", isSummary: true, attachments: [{ name: "a.pdf", mimeType: "application/pdf", bytes: 2048 }] }),
    msg(2, { text: "<img src=x onerror=alert(1)><script>alert(2)</script> javascript:alert(3)" }),
    msg(1, { isFromMe: false, text: "First" }),
  ], nextCursor: null, hasMore: false } }) });
  const dialogs: string[] = [];
  p.on("dialog", (d) => { dialogs.push(d.message()); void d.dismiss(); });
  await p.setViewportSize({ width: 1280, height: 900 });
  await p.goto(`${svc.url}/inbox/c_1`);
  const log = p.getByRole("log", { name: "Messages with Anna Kovacs" });
  await expect(log).toBeVisible();
  const articles = log.getByRole("article");
  await expect(articles).toHaveCount(3);
  await expect(articles.nth(0)).toHaveAccessibleName(/^iMessage from Anna Kovacs, /);
  await expect(articles.nth(1)).toHaveAccessibleName(/^iMessage sent by you, /);
  await expect(articles.nth(2)).toHaveAccessibleName(/^Email sent by you|^Email from Anna Kovacs/);
  await expect(log.getByRole("heading", { level: 3 }).first()).toBeVisible();
  await expect(log.getByText("Email summary")).toBeVisible();
  await expect(log.getByText("Attachment: a.pdf · 2 KB (not downloadable)")).toBeVisible();
  await expect(log.getByText("<img src=x onerror=alert(1)>", { exact: false })).toBeVisible();
  expect(await log.locator("img[src='x'], script").count()).toBe(0);
  expect(dialogs).toEqual([]);
  const [a, b] = [await articles.nth(0).boundingBox(), await articles.nth(1).boundingBox()];
  expect(b!.x + b!.width, "sent aligns to the trailing side").toBeGreaterThan(a!.x + a!.width);
  expect(await p.getByRole("heading", { level: 2, name: "Anna Kovacs" }).count()).toBe(1);
  await expect(p.getByText("42 messages · iMessage 30 · Email 12")).toBeVisible();
});

test("opens at the newest message; Load earlier keeps the same message in view and appends without duplicates", async ({ page: p }) => {
  await mock(p, { messages: NEWEST_FIRST });
  await p.setViewportSize({ width: 1280, height: 700 });
  await p.goto(`${svc.url}/inbox/c_1`);
  await expect.poll(() => onScreen(p.getByText("Message number 70", { exact: true }))).toBe(true);
  await p.evaluate(() => document.getElementById("msg-m21")!.scrollIntoView({ block: "start" }));
  await p.getByRole("button", { name: "Load earlier messages" }).evaluate((el) => (el as HTMLElement).scrollIntoView());
  await p.getByRole("button", { name: "Load earlier messages" }).click();
  await expect(p.getByText("Message number 20", { exact: true })).toBeAttached();
  await expect.poll(() => onScreen(p.getByText("Message number 21", { exact: true }))).toBe(true);
  await expect(p.getByText("Start of the conversation")).toBeVisible();
  expect(await p.getByRole("article").count()).toBe(70);
  await expect(p.getByRole("button", { name: "Load earlier messages" })).toHaveCount(0);
});

test("channel filter is in the URL and in the request; empty variants", async ({ page: p }) => {
  const seen: string[] = [];
  await mock(p, { messages: (u) => { seen.push(u.search); return { body: u.searchParams.get("channel") === "whatsapp" ? { items: [], nextCursor: null, hasMore: false } : page(1, 3, null) }; } });
  await p.goto(`${svc.url}/inbox/c_1?thread=email`);
  await expect(p.getByRole("button", { name: "Only Email", pressed: true })).toBeVisible();
  expect(seen[0]).toContain("channel=email");
  await p.getByRole("button", { name: "Only WhatsApp" }).click();
  await expect(p).toHaveURL(/thread=whatsapp/);
  await expect(p.getByText("No WhatsApp messages with Anna Kovacs yet.")).toBeVisible();
  await p.getByRole("button", { name: "Show all channels" }).click();
  await expect(p).not.toHaveURL(/thread=/);
  await expect(p.getByRole("article").first()).toBeVisible();
});

test("contact with no messages at all", async ({ page: p }) => {
  await mock(p, { messages: () => ({ body: { items: [], nextCursor: null, hasMore: false } }) });
  await p.goto(`${svc.url}/inbox/c_1`);
  await expect(p.getByText("No messages with this person yet")).toBeVisible();
});

test("error shows the reference and recovers; a failing Load earlier keeps the loaded messages", async ({ page: p }) => {
  let fail = true;
  await mock(p, { messages: (u) => fail ? { status: 500, body: { error: { code: "boom", message: "Broke.", requestId: "req-7", retryable: false } } } : (u.searchParams.get("before") ? { status: 500, body: { error: { code: "boom", message: "Broke.", requestId: "req-8", retryable: false } } } : { body: page(1, 3, "older") }) });
  await p.goto(`${svc.url}/inbox/c_1`);
  await expect(p.getByText("Messages could not be loaded")).toBeVisible();
  await expect(p.getByText(/reference req-7/)).toBeVisible();
  await expectAccessibleNow(p, "thread error");
  fail = false;
  await p.getByRole("button", { name: "Try again" }).click();
  await expect(p.getByRole("article")).toHaveCount(3);
  await p.getByRole("button", { name: "Load earlier messages" }).click();
  await expect(p.getByRole("alert").filter({ hasText: "Earlier messages could not be loaded" })).toBeVisible();
  await expect(p.getByRole("article")).toHaveCount(3);
});

test("merged-away contact links to the target; unknown contact says so", async ({ page: p }) => {
  await mock(p, { contactStatus: 404, contactBody: { error: { code: "contact_not_found", message: "merged", requestId: "r", retryable: false, details: { mergedInto: "c_9" } } }, messages: () => ({ body: page(1, 1, null) }) });
  await p.goto(`${svc.url}/inbox/c_1`);
  await expect(p.getByText("This contact no longer exists")).toBeVisible();
  await expect(p.getByRole("link", { name: "Open the merged contact" })).toHaveAttribute("href", "/inbox/c_9");
  await expect(p.getByRole("link", { name: "Back to Inbox" })).toBeVisible();
});

test("a blocked source is called out when its channel is filtered", async ({ page: p }) => {
  await mock(p, { messages: () => ({ body: page(1, 2, null) }) });
  await p.route("**/api/status", async (route) => {
    const res = await route.fetch(); const body = await res.json();
    body.connectors = [{ id: "imessage", label: "iMessage", state: "blocked", message: "Cannot read Messages.", messagesTotal: 0 }];
    await route.fulfill({ response: res, json: body });
  });
  await p.goto(`${svc.url}/inbox/c_1?thread=imessage`);
  await expect(p.getByText("iMessage is not syncing")).toBeVisible();
});

test("new messages: followed at the bottom, announced behind a button when reading older ones", async ({ page: p, browserName }) => {
  test.skip(browserName === "webkit", "WebKit stands still under the fake clock (its smooth scrolling and scroll anchoring run on timers); opening at the newest message is covered without it");
  let extra = false;
  await p.clock.install();
  await mock(p, { messages: () => ({ body: { items: [...(extra ? [msg(71)] : []), ...page(21, 70, null).items], nextCursor: null, hasMore: false } }) });
  await p.setViewportSize({ width: 1280, height: 700 });
  await p.goto(`${svc.url}/inbox/c_1`);
  await expect.poll(() => onScreen(p.getByText("Message number 70", { exact: true }))).toBe(true);
  await p.evaluate(() => document.getElementById("msg-m21")!.scrollIntoView({ block: "start" }));
  await p.getByText("Message number 21", { exact: true }).hover(); // scrolled away from the bottom
  await expect.poll(() => onScreen(p.getByText("Message number 70", { exact: true }))).toBe(false);
  await p.waitForTimeout(500); // real time: let the browser tell the app it is no longer at the bottom before new messages arrive (the fake clock does not move it)
  extra = true;
  // one poll interval of the fake clock per try: on a slow runner the answer to the poll may arrive after the first tick
  await expect.poll(async () => { await p.clock.runFor(31_000); return p.getByRole("button", { name: "1 new message" }).count(); }, { timeout: 30_000 }).toBe(1);
  await expect(p.getByRole("button", { name: "1 new message" })).toBeVisible();
  await expect(p.getByRole("status").filter({ hasText: "1 new message" })).toHaveCount(1);
  await p.getByRole("button", { name: "1 new message" }).evaluate((el) => (el as HTMLElement).click()); // under the fake clock a slow runner re-renders it while Playwright waits for it to be 'stable'
  await expect.poll(() => onScreen(p.getByText("Message number 71", { exact: true }))).toBe(true);
});

test("a11y gate: populated and empty in light and dark, populated at 375 px", async ({ page: p }) => {
  await mock(p, { messages: NEWEST_FIRST });
  for (const scheme of ["light", "dark"] as const) {
    await p.emulateMedia({ colorScheme: scheme });
    await expectAccessible(p, `${svc.url}/inbox/c_1`);
    await expect(p.getByRole("log")).toBeVisible();
  }
  await p.setViewportSize({ width: 375, height: 800 });
  await expectAccessible(p, `${svc.url}/inbox/c_1`);
  expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await p.unroute(/\/api\/contacts\/c_1\/messages\?/);
  await p.route(/\/api\/contacts\/c_1\/messages\?/, (r) => json(r, { items: [], nextCursor: null, hasMore: false }));
  await expectAccessible(p, `${svc.url}/inbox/c_1`);
});
