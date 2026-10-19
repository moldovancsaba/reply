import { expect, test, type Page, type Route } from "@playwright/test";
import { expectAccessible, expectAccessibleNow } from "./a11y";
import { startService, type Service } from "./service";

let svc: Service;
test.beforeEach(async () => { svc = await startService({ seed: true }); });
test.afterEach(async () => { await svc.stop(); });

const json = (r: Route, body: unknown, status = 200) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
// Stand-in for the OS handing the link to an app: the app records what would be opened.
const captureOpens = (p: Page) => p.addInitScript(() => {
  (window as unknown as { __opened: string[] }).__opened = [];
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) { (window as unknown as { __opened: string[] }).__opened.push(this.href); };
});
const opened = (p: Page) => p.evaluate(() => (window as unknown as { __opened: string[] }).__opened);
const phone = (p: Page) => p.getByRole("list", { name: "Conversations" }).getByRole("link").filter({ hasText: "+36301234567" });
const area = (p: Page) => p.getByLabel("Message", { exact: true });

async function openPhoneThread(p: Page) {
  await p.goto(`${svc.url}/inbox`);
  await phone(p).click();
  await expect(p.getByRole("heading", { level: 3, name: "Reply" })).toBeVisible();
}
async function mergeEmailIntoPhone(p: Page) {
  const list = await (await p.request.get(`${svc.url}/api/contacts`)).json();
  const id = (n: string) => list.items.find((c: { displayName: string }) => c.displayName === n).id;
  const r = await p.request.post(`${svc.url}/api/contacts/${id("+36301234567")}/merge`, { data: { sourceContactId: id("anna@example.com") } });
  expect(r.status()).toBe(200);
}

test("real handoff: recipient and app are visible first; the exact text is in the link; nothing is sent; draft cleared and focus returns", async ({ page }) => {
  await captureOpens(page);
  const logged: string[] = [];
  page.on("console", (m) => logged.push(m.text()));
  await openPhoneThread(page);
  await expect(page.getByRole("radiogroup", { name: "Send through" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "iMessage · +36 30 123 4567" })).toBeChecked();
  await expect(page.getByText(/To \+36301234567 through iMessage \(\+36 30 123 4567\)\. Reply Core opens Messages with your text; you press send there\. Reply Core never sends anything itself\./)).toBeVisible();
  const text = "See you at 6 & bring #the 100% \"plan\"\nsecond line 😀";
  await area(page).fill(text);
  await page.getByRole("button", { name: "Open in Messages" }).click();
  await expect.poll(async () => (await opened(page)).length).toBe(1);
  const url = (await opened(page))[0];
  expect(url.startsWith("sms:")).toBe(true);
  expect(decodeURIComponent(url.split("body=")[1])).toBe(text);
  await expect(page.getByText("Opens Messages with your text. Reply Core does not send it.")).toBeVisible();
  await expect(page.getByText(/Press send there; the message will appear here after the next sync/)).toBeVisible();
  await expect(area(page)).toHaveValue("");
  await expect(area(page)).toBeFocused();
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
  expect(logged.join("\n"), "the message text never reaches the console").not.toContain("bring");
});

test("merged contact offers both channels, defaults to the newest message's channel, and Mail opens mailto", async ({ page }) => {
  await captureOpens(page);
  await mergeEmailIntoPhone(page);
  await openPhoneThread(page);
  const radios = page.getByRole("radiogroup", { name: "Send through" }).getByRole("radio");
  await expect(radios).toHaveCount(2);
  await expect(page.getByRole("radio", { name: /^iMessage/ })).toBeChecked();
  await area(page).fill("Hello by mail");
  await page.getByRole("radio", { name: /^Email/ }).check();
  await expect(page.getByRole("button", { name: "Open in Mail" })).toBeVisible();
  await expect(page.getByText(/through Email \(anna@example\.com\)/)).toBeVisible();
  await page.getByRole("button", { name: "Open in Mail" }).click();
  await expect.poll(async () => (await opened(page)).length).toBe(1);
  expect((await opened(page))[0]).toMatch(/^mailto:anna(@|%40)example\.com\?.*body=Hello%20by%20mail/);
  // arrow keys move between the radios
  await page.getByRole("radio", { name: /^Email/ }).focus();
  await page.keyboard.press("ArrowUp");
  await expect(page.getByRole("radio", { name: /^iMessage/ })).toBeChecked();
});

test("oversized text: warning hint, copy-and-open with no body in the link, and the notice says it was copied", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await captureOpens(page);
  await openPhoneThread(page);
  const big = "x".repeat(1600);
  await area(page).fill(big);
  await expect(page.getByText("Long messages will be copied to the clipboard instead of prefilled.")).toBeVisible();
  await page.getByRole("button", { name: "Open in Messages" }).click();
  await expect.poll(async () => (await opened(page)).length).toBe(1);
  expect((await opened(page))[0]).not.toContain("body=");
  await expect(page.getByText(/Your text was copied; paste it in the message\./)).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(big);
});

test("a double click sends one request; an empty message sends none and moves focus to the alert", async ({ page }) => {
  const posts: string[] = [];
  page.on("request", (r) => { if (r.method() === "POST" && r.url().endsWith("/api/handoff")) posts.push(r.postData() ?? ""); });
  await captureOpens(page);
  await openPhoneThread(page);
  await page.getByRole("button", { name: "Open in Messages" }).click();
  await expect(page.getByRole("alert")).toContainText("Write a message first.");
  await expect(page.locator("div[tabindex='-1']:not(#main-content)").filter({ has: page.getByRole("alert") })).toBeFocused();
  expect(posts).toEqual([]);
  await area(page).fill("Once");
  await page.getByRole("button", { name: "Open in Messages" }).dblclick();
  await expect.poll(async () => (await opened(page)).length).toBeGreaterThan(0);
  expect(posts).toHaveLength(1);
  expect(await opened(page)).toHaveLength(1);
});

test("a failed handoff keeps the text, explains in words and focuses the alert", async ({ page }) => {
  await page.route("**/api/handoff", (r) => json(r, { error: { code: "no_handle_for_channel", message: "x", requestId: "r", retryable: false, details: { availableChannels: [] } } }, 422));
  await captureOpens(page);
  await openPhoneThread(page);
  await area(page).fill("Keep me");
  await page.getByRole("button", { name: "Open in Messages" }).click();
  await expect(page.getByRole("alert")).toContainText("This person has no address for that channel any more.");
  await expect(area(page)).toHaveValue("Keep me");
  expect(await opened(page)).toEqual([]);
  await expectAccessibleNow(page, "composer error");
});

test("drafts survive navigation and reload within the session, and a missing sessionStorage does not break the composer", async ({ page }) => {
  await openPhoneThread(page);
  await area(page).fill("Half written");
  await expect(page.getByText("Draft saved")).toBeVisible();
  await page.locator("nav a[href='/search']").click();
  await page.goBack();
  await expect(area(page)).toHaveValue("Half written");
  await page.reload();
  await expect(area(page)).toHaveValue("Half written");

  const p2 = await page.context().newPage();
  await p2.addInitScript(() => { Object.defineProperty(window, "sessionStorage", { get() { throw new Error("blocked"); } }); });
  await p2.goto(`${svc.url}/inbox`);
  await phone(p2).click();
  await area(p2).fill("No storage");
  await expect(p2.getByRole("button", { name: "Open in Messages" })).toBeEnabled();
  await expect(p2.getByText("Draft saved")).toHaveCount(0);
});

test("a contact with no usable channel gets guidance instead of a composer", async ({ page }) => {
  await page.route(/\/api\/contacts\/[^/]+$/, async (r) => { const res = await r.fetch(); const body = await res.json(); body.replyChannels = []; await json(r, body); });
  await page.goto(`${svc.url}/inbox`);
  await phone(page).click();
  await expect(page.getByText("No way to reach this person from here yet")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open the profile" })).toBeVisible();
  await expectAccessibleNow(page, "composer no channels");
});

test("a11y gate: composer idle in light and dark and at 375 px; keyboard-only completion", async ({ page }) => {
  await captureOpens(page);
  await page.goto(`${svc.url}/inbox`);
  const href = await phone(page).getAttribute("href");
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `${svc.url}${href}`);
    await expect(page.getByRole("heading", { level: 3, name: "Reply" })).toBeVisible();
  }
  await page.setViewportSize({ width: 375, height: 800 });
  await expectAccessible(page, `${svc.url}${href}`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // keyboard only: focus the message, type, Tab to the primary button, Enter
  await captureOpens(page);
  await page.goto(`${svc.url}${href}`);
  await area(page).focus();
  await page.keyboard.type("Typed by keyboard");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Open in Messages" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await opened(page)).length).toBe(1);
});
