import { expect, test, type Page, type Route } from "@playwright/test";
import { expectAccessible, expectAccessibleNow } from "./a11y";
import { startService, type Service } from "./service";

let svc: Service;
test.beforeAll(async () => { svc = await startService(); });
test.afterAll(async () => { await svc.stop(); });

const json = (r: Route, body: unknown, status = 200) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const counts = (imessage = 0, email = 0, whatsapp = 0) => ({ imessage, email, whatsapp });
const person = (i: number, over: Record<string, unknown> = {}) => ({
  id: `c_${i}`, displayName: `Person ${i}`, lastTs: new Date(Date.now() - i * 300_000).toISOString(), lastChannel: "imessage", lastPreview: `Hello number ${i}`,
  lastFromMe: false, counts: counts(i, 1, 0), countTotal: i + 1, handles: [], ...over,
});
const page1 = { items: Array.from({ length: 3 }, (_, i) => person(i + 1)), nextCursor: "next", hasMore: true, total: 4 };
const page2 = { items: [person(4, { displayName: "Zed Last", lastChannel: "email", lastFromMe: true })], nextCursor: null, hasMore: false, total: 4 };

async function mockContacts(page: Page, handler: (url: URL) => { status?: number; body: unknown }) {
  await page.route("**/api/contacts?*", (route) => {
    const r = handler(new URL(route.request().url()));
    return route.fulfill({ status: r.status ?? 200, contentType: "application/json", body: JSON.stringify(r.body) });
  });
}

test("populated list: rows are links with full accessible names, Load more appends, pages are announced", async ({ page }) => {
  const logged: string[] = [];
  page.on("console", (m) => logged.push(m.text()));
  await mockContacts(page, (u) => ({ body: u.searchParams.get("cursor") ? page2 : page1 }));
  await page.goto(`${svc.url}/inbox`);
  const row = page.getByRole("link", { name: /^Person 1 Hello number 1 iMessage 5 minutes ago/ });
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute("href", "/inbox/c_1");
  await expect(page.getByText("Showing 3 of 4 conversations")).toBeVisible();
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(page.getByRole("link", { name: /^Zed Last.*You: / })).toBeVisible();
  await expect(page.getByText("Showing 4 of 4 conversations")).toBeVisible();
  await expect(page.getByRole("button", { name: "Load more" })).toHaveCount(0);
  await expectAccessibleNow(page, "inbox populated");
  expect(logged.join("\n"), "no names or message text in the console").not.toMatch(/Person \d|Hello number|Zed Last/);
});

test("one row renders with singular wording", async ({ page }) => {
  await mockContacts(page, () => ({ body: { items: [person(1, { counts: counts(1, 0, 0) })], nextCursor: null, hasMore: false, total: 1 } }));
  await page.goto(`${svc.url}/inbox`);
  await expect(page.getByText("Showing 1 of 1 conversation", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Load more" })).toHaveCount(0);
});

test("channel filter and search live in the URL and in the request; chips remove them", async ({ page }) => {
  const seen: string[] = [];
  await mockContacts(page, (u) => { seen.push(u.search); return { body: page2 }; });
  await page.goto(`${svc.url}/inbox?q=zed&channel=email`);
  await expect(page.getByRole("button", { name: "Email", pressed: true })).toBeVisible();
  await expect(page.getByLabel("Search names")).toHaveValue("zed");
  expect(seen[0]).toContain("q=zed");
  expect(seen[0]).toContain("channel=email");
  await page.getByRole("button", { name: "WhatsApp" }).click();
  await expect(page).toHaveURL(/channel=whatsapp/);
  await page.getByLabel("Search names").fill("ann");
  await expect(page).toHaveURL(/q=ann/);
  await page.getByRole("button", { name: "Clear filters" }).first().click();
  await expect(page).toHaveURL(/\/inbox$/);
  await expect(page.getByLabel("Search names")).toHaveValue("");
});

test("no match with filters offers Clear filters; no data offers Sources", async ({ page }) => {
  await mockContacts(page, (u) => ({ body: { items: [], nextCursor: null, hasMore: false, total: 0 }, status: 200 + 0 * u.search.length }));
  await page.goto(`${svc.url}/inbox?q=nobody`);
  await expect(page.getByText("No conversations match")).toBeVisible();
  await expectAccessibleNow(page, "inbox no match");
  await page.getByRole("button", { name: "Clear filters" }).last().click();
  await expect(page.getByText("No conversations yet")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Sources" })).toBeVisible();
});

test("error shows the request reference and Try again recovers", async ({ page }) => {
  let fail = true;
  await mockContacts(page, () => fail ? { status: 400, body: { error: { code: "bad", message: "Nope.", requestId: "req-9", retryable: false } } } : { body: page2 });
  await page.goto(`${svc.url}/inbox`);
  await expect(page.getByText("Conversations could not be loaded")).toBeVisible();
  await expect(page.getByText(/reference req-9/)).toBeVisible();
  await expectAccessibleNow(page, "inbox error");
  fail = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("link", { name: /^Zed Last/ })).toBeVisible();
});

test("a blocked source is called out above the list", async ({ page }) => {
  await mockContacts(page, () => ({ body: page2 }));
  await page.route("**/api/status", async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    body.connectors = [{ id: "imessage", label: "iMessage", state: "blocked", message: "Reply Core cannot read Messages.", messagesTotal: 0 }];
    await route.fulfill({ response: res, json: body });
  });
  await page.goto(`${svc.url}/inbox`);
  await expect(page.getByText("iMessage: needs your attention")).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("may be missing");
});

test("desktop shows list and detail side by side; phone shows the list, then the detail with a way back", async ({ page }) => {
  await mockContacts(page, () => ({ body: page2 }));
  await page.route(/\/api\/contacts\/c_4$/, (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ...page2.items[0], origin: "auto" }) }));
  await page.route(/\/api\/contacts\/c_4\/messages\?/, (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ items: [{ id: "m1", channel: "email", isFromMe: true, ts: new Date().toISOString(), text: "Hi there", attachments: [], counterpartHandle: "z" }], nextCursor: null, hasMore: false }) }));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${svc.url}/inbox/c_4`);
  await expect(page.getByRole("link", { name: /^Zed Last/ })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("log")).toBeVisible();
  const [listBox, detailBox] = await Promise.all([page.getByRole("list", { name: "Conversations" }).boundingBox(), page.getByRole("log").boundingBox()]);
  expect(detailBox!.x, "detail sits to the right of the list").toBeGreaterThan(listBox!.x + listBox!.width);
  await page.setViewportSize({ width: 375, height: 800 });
  await expect(page.getByRole("link", { name: "Back to conversations" })).toBeVisible();
  await expect(page.getByLabel("Search names")).toHaveCount(0);
  await page.getByRole("link", { name: "Back to conversations" }).click();
  await expect(page.getByRole("link", { name: /^Zed Last/ })).toBeVisible();
  await expect(page.locator("body")).not.toHaveJSProperty("scrollWidth", 0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("a11y gate: real empty service in light and dark, and populated at phone width", async ({ page }) => {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `${svc.url}/inbox`);
    await expect(page.getByText("No conversations yet")).toBeVisible();
  }
  await mockContacts(page, (u) => ({ body: u.searchParams.get("cursor") ? page2 : page1 }));
  await page.setViewportSize({ width: 375, height: 800 });
  await expectAccessible(page, `${svc.url}/inbox`);
});

test("a conversation with new messages says how many, and opening it marks it seen", async ({ page }) => {
  let reads = 0;
  let unread = 2;
  await page.route(/\/api\/contacts\?/, (r) => json(r, { items: [person(1, { unread })], nextCursor: null, hasMore: false, total: 1 }));
  await page.route(/\/api\/contacts\/c_1\/read$/, (r) => { reads++; unread = 0; return json(r, { unread: 0 }); });
  await page.route(/\/api\/contacts\/c_1$/, (r) => json(r, { id: "c_1", displayName: "Person 1", origin: "auto", counts: counts(1, 0, 0), countTotal: 1, handles: [], replyChannels: [] }));
  await page.route(/\/api\/contacts\/c_1\/messages\?/, (r) => json(r, { items: [{ id: "m1", channel: "imessage", isFromMe: false, ts: new Date().toISOString(), text: "hi", attachments: [], counterpartHandle: "x" }], nextCursor: null, hasMore: false }));
  await page.goto(`${svc.url}/inbox`);
  await expect(page.getByRole("link", { name: /Person 1.*2 new/ })).toBeVisible();
  await page.getByRole("link", { name: /Person 1/ }).click();
  await expect.poll(() => reads, { timeout: 5000 }).toBeGreaterThan(0);
  await expect(page.getByText("2 new")).toHaveCount(0);
});
