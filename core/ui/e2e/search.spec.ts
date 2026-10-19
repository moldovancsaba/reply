import { expect, test, type Page, type Route } from "@playwright/test";
import { expectAccessible, expectAccessibleNow } from "./a11y";
import { startService, type Service } from "./service";

let svc: Service;
test.beforeAll(async () => { svc = await startService({ seed: true }); });
test.afterAll(async () => { await svc.stop(); });

const A = "\u0001";
const B = "\u0002";
const hit = (i: number, over: Record<string, unknown> = {}) => ({ messageId: `m${i}`, contactId: "c_1", contactName: "Anna Kovacs", channel: "imessage", ts: new Date(Date.now() - i * 60_000).toISOString(), snippet: `see the ${A}invoice${B} number ${i}`, ...over });
const json = (r: Route, body: unknown, status = 200) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const search = (p: Page, handler: (u: URL) => { status?: number; body: unknown; delay?: number }) =>
  p.route(/\/api\/search\?/, async (r) => { const o = handler(new URL(r.request().url())); if (o.delay) await new Promise((res) => setTimeout(res, o.delay)); await json(r, o.body, o.status ?? 200); });

test("initial and too-short states guide without alarm", async ({ page }) => {
  await page.goto(`${svc.url}/search`);
  await expect(page.getByText("Search your messages and email")).toBeVisible();
  await expect(page.getByRole("search")).toBeVisible();
  await page.getByLabel("Search messages").fill("a");
  await expect(page.getByText("Type at least 2 characters.").first()).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expectAccessibleNow(page, "search too short");
});

test("real search across channels: highlights, searched channels, click opens the thread", async ({ page }) => {
  const logged: string[] = [];
  page.on("console", (m) => logged.push(m.text()));
  await page.goto(`${svc.url}/search`);
  await page.getByLabel("Search messages").fill("hello");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(/q=hello/);
  const list = page.getByRole("list", { name: "Search results" });
  await expect(list.getByRole("listitem")).toHaveCount(5);
  await expect(page.getByRole("status").filter({ hasText: /5 results for/ })).toBeVisible();
  await expect(page.getByText("Searched iMessage, Email and WhatsApp")).toBeVisible();
  expect(await list.locator("mark").count()).toBeGreaterThan(0);
  await expectAccessibleNow(page, "search results");
  await list.getByRole("link").first().click();
  await expect(page).toHaveURL(/\/inbox\/[^/]+$/);
  await expect(page.getByRole("log")).toBeVisible();
  expect(logged.join("\n").toLowerCase(), "no query text in the console").not.toContain("hello");
});

test("channel filter and conversation scope live in the URL and in the request; chips remove them", async ({ page }) => {
  const seen: string[] = [];
  await search(page, (u) => { seen.push(u.search); return { body: { items: [hit(1)], nextCursor: null, hasMore: false } }; });
  await page.route(/\/api\/contacts\/c_1$/, (r) => json(r, { id: "c_1", displayName: "Anna Kovacs", origin: "auto", counts: { imessage: 1, email: 0, whatsapp: 0 }, countTotal: 1, handles: [] }));
  await page.goto(`${svc.url}/search?q=invoice&channel=email&contactId=c_1`);
  await expect(page.getByText("In conversation with Anna Kovacs")).toBeVisible();
  await expect(page.getByRole("button", { name: "Only Email", pressed: true })).toBeVisible();
  expect(seen[0]).toContain("channel=email");
  expect(seen[0]).toContain("contactId=c_1");
  await page.getByRole("button", { name: "Remove conversation filter" }).click();
  await expect(page).not.toHaveURL(/contactId/);
  await page.getByRole("button", { name: "Only iMessage" }).click();
  await expect(page).toHaveURL(/channel=imessage/);
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page).toHaveURL(/\/search$/);
  await expect(page.getByText("Search your messages and email")).toBeVisible();
});

test("search as you type after 3 characters; a late answer for an older query never replaces the newer one", async ({ page }) => {
  await search(page, (u) => u.searchParams.get("q") === "inv" ? { delay: 1500, body: { items: [hit(1, { snippet: `OLD ${A}inv${B}` })], nextCursor: null, hasMore: false } } : { body: { items: [hit(2, { snippet: `NEW ${A}invo${B}` })], nextCursor: null, hasMore: false } });
  await page.goto(`${svc.url}/search`);
  const box = page.getByLabel("Search messages");
  await box.pressSequentially("inv");
  await expect(page).toHaveURL(/q=inv$/);
  await box.pressSequentially("o");
  await expect(page.getByText(/NEW/)).toBeVisible();
  await page.waitForTimeout(1800);
  await expect(page.getByText(/NEW/)).toBeVisible();
  await expect(page.getByText(/OLD/)).toHaveCount(0);
});

test("hostile snippet renders as text; marks are <mark> elements", async ({ page }) => {
  const dialogs: string[] = [];
  page.on("dialog", (d) => { dialogs.push(d.message()); void d.dismiss(); });
  await search(page, () => ({ body: { items: [hit(1, { snippet: `<img src=x onerror=alert(1)> ${A}<script>alert(2)</script>${B} javascript:alert(3)` })], nextCursor: null, hasMore: false } }));
  await page.goto(`${svc.url}/search?q=script`);
  const list = page.getByRole("list", { name: "Search results" });
  await expect(list.locator("mark")).toHaveText("<script>alert(2)</script>");
  expect(await list.locator("img, script").count()).toBe(0);
  expect(dialogs).toEqual([]);
});

test("no results, error with retry, load more", async ({ page }) => {
  let mode: "none" | "error" | "pages" = "none";
  await search(page, (u) => {
    if (mode === "none") return { body: { items: [], nextCursor: null, hasMore: false } };
    if (mode === "error") return { status: 500, body: { error: { code: "boom", message: "Broke.", requestId: "req-5", retryable: false } } };
    return { body: u.searchParams.get("cursor") ? { items: [hit(3), hit(4)], nextCursor: null, hasMore: false } : { items: [hit(1), hit(2)], nextCursor: "n", hasMore: true } };
  });
  await page.goto(`${svc.url}/search?q=nothing&channel=imessage`);
  await expect(page.getByText("No results for “nothing” in iMessage.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear filters" }).first()).toBeVisible();
  await expectAccessibleNow(page, "search empty");
  mode = "error";
  await page.goto(`${svc.url}/search?q=other`);
  await expect(page.getByText("The search did not work")).toBeVisible();
  await expect(page.getByText(/reference req-5/)).toBeVisible();
  await expectAccessibleNow(page, "search error");
  mode = "pages";
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("list", { name: "Search results" }).getByRole("listitem")).toHaveCount(2);
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(page.getByRole("list", { name: "Search results" }).getByRole("listitem")).toHaveCount(4);
});

test("a channel that is not connected or not syncing is said so", async ({ page }) => {
  await search(page, () => ({ body: { items: [hit(1)], nextCursor: null, hasMore: false } }));
  await page.route("**/api/status", async (route) => {
    const res = await route.fetch(); const body = await res.json();
    body.connectors = [{ id: "whatsapp", label: "WhatsApp", state: "never_synced", message: "Not set up.", messagesTotal: 0 }, { id: "imessage", label: "iMessage", state: "blocked", message: "Cannot read Messages.", messagesTotal: 0 }];
    await route.fulfill({ response: res, json: body });
  });
  await page.goto(`${svc.url}/search?q=invoice`);
  await expect(page.getByText("WhatsApp is not connected, so it was not searched.")).toBeVisible();
  await expect(page.getByText("iMessage is not syncing, so recent messages may be missing from the results.")).toBeVisible();
  await expect(page.getByText("Searched iMessage and Email")).toBeVisible();
});

test("a11y gate: initial and results in light and dark, results at 375 px", async ({ page }) => {
  await search(page, () => ({ body: { items: [hit(1), hit(2)], nextCursor: "n", hasMore: true } }));
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `${svc.url}/search`);
    await expectAccessible(page, `${svc.url}/search?q=invoice`);
    await expect(page.getByRole("list", { name: "Search results" })).toBeVisible();
  }
  await page.setViewportSize({ width: 375, height: 800 });
  await expectAccessible(page, `${svc.url}/search?q=invoice`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
