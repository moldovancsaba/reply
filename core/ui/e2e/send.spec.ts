import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";
import { expectAccessible, expectAccessibleNow, expectFocusTrapped } from "./a11y";
import { startService, type Service } from "./service";

let svc: Service;
// Every service here uses the fake driver (see e2e/service.ts): "sending" appends to sent-fake.jsonl and nothing leaves the machine.
test.beforeEach(async () => { svc = await startService({ seed: true }); });
test.afterEach(async () => { await svc.stop(); });

const json = (r: Route, body: unknown, status = 200) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const phone = (p: Page) => p.getByRole("list", { name: "Conversations" }).getByRole("link").filter({ hasText: "+36301234567" });
const area = (p: Page) => p.getByLabel("Message", { exact: true });
const sentLog = () => { const f = path.join(svc.home, "sent-fake.jsonl"); return existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []; };
async function open(p: Page) {
  await p.setViewportSize({ width: 1440, height: 1000 });
  await p.goto(`${svc.url}/inbox`);
  await phone(p).click();
  await expect(p.getByRole("heading", { level: 3, name: "Reply" })).toBeVisible();
}

test("Send asks first, shows exactly what goes to whom, and nothing is sent until you confirm", async ({ page }) => {
  await open(page);
  const text = "See you at 6 & bring the #plan\nsecond line 😀";
  await area(page).fill(text);
  await expect(page.getByText("To +36301234567 through iMessage (+36 30 123 4567). Send sends it now, through Messages on this Mac.")).toBeVisible();
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Send this message?");
  await expect(dialog).toContainText("To +36301234567 through iMessage (+36 30 123 4567)");
  await expect(dialog).toContainText("See you at 6 & bring the #plan");
  await expect(dialog).toContainText("second line 😀");
  await expect(dialog).toContainText("cannot be taken back");
  await page.waitForTimeout(600);
  await expectAccessibleNow(page, "send confirmation");
  await expectFocusTrapped(page, "[role=dialog]", "send confirmation");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(sentLog()).toEqual([]);
  await expect(area(page)).toHaveValue(text);

  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Send", exact: true }).dblclick();
  await expect(page.getByText("Sent through Messages to +36301234567.")).toBeVisible();
  await expect.poll(() => sentLog().length).toBe(1);
  expect(sentLog()[0]).toMatchObject({ channel: "imessage", handle: "+36301234567", text });
  await expect(area(page)).toHaveValue("");
  await expect(area(page)).toBeFocused();
  expect(sentLog(), "the double click sent one message").toHaveLength(1);
});

test("with 'Ask me before sending' off, Send sends at once; the choice is remembered", async ({ page }) => {
  await open(page);
  await page.getByText("Ask me before sending").click();
  await expect(page.getByLabel("Ask me before sending")).not.toBeChecked();
  await area(page).fill("No questions asked");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(() => sentLog().length).toBe(1);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel("Ask me before sending")).not.toBeChecked();
});

test("email: the subject starts as a reply to the last one and goes with the message", async ({ page }) => {
  const list = await (await page.request.get(`${svc.url}/api/contacts`)).json();
  const id = (n: string) => list.items.find((c: { displayName: string }) => c.displayName === n).id;
  await page.request.post(`${svc.url}/api/contacts/${id("+36301234567")}/merge`, { data: { sourceContactId: id("anna@example.com") } });
  await open(page);
  await page.getByRole("radio", { name: /^Email/ }).check();
  await expect(page.getByLabel("Subject")).toHaveValue(/^Re: Subject \d$/);
  await page.getByLabel("Subject").fill("Re: the plan");
  await area(page).fill("Sounds good.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Subject: Re: the plan");
  await page.getByRole("dialog").getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(() => sentLog().length).toBe(1);
  expect(sentLog()[0]).toMatchObject({ channel: "email", handle: "anna@example.com", subject: "Re: the plan", text: "Sounds good." });
});

test("a macOS permission problem is explained step by step, with a way to ask for it; the text stays", async ({ page }) => {
  await page.route("**/api/send", (r) => json(r, { error: { code: "automation_denied", message: "{reply} is not allowed to control Messages.", requestId: "r", retryable: false, details: { recovery: [
    { order: 1, text: "Open System Settings > Privacy & Security > Automation.", deepLink: "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation" },
    { order: 2, text: "Switch on Messages under {reply}." },
  ] } } }, 403));
  let consent = 0;
  await page.route("**/api/send/consent", (r) => { consent++; return json(r, { opened: true }, 202); });
  await open(page);
  await area(page).fill("Keep me");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Send", exact: true }).click();
  const alert = page.getByRole("alert").filter({ hasText: "The message was not sent" });
  await expect(alert).toContainText("{reply} is not allowed to control Messages.");
  await expect(alert.getByRole("link", { name: "Open Automation settings" })).toBeVisible();
  await expect(alert.getByRole("list", { name: "What to do" }).getByRole("listitem")).toHaveCount(2);
  await expect(area(page)).toHaveValue("Keep me");
  await alert.getByRole("button", { name: "Allow {reply} to send" }).click();
  await expect.poll(() => consent).toBe(1);
  await expect(page.getByText("Look for a macOS window.")).toBeVisible();
  await expectAccessibleNow(page, "send permission error");
});

test("a send that timed out says the message may have been sent and does not offer a blind retry", async ({ page }) => {
  await page.route("**/api/send", (r) => json(r, { error: { code: "send_timeout", message: "Messages did not answer in time. The message may have been sent: check the conversation before sending again.", requestId: "r", retryable: false } }, 504));
  await open(page);
  await area(page).fill("Maybe sent");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Send", exact: true }).click();
  const alert = page.getByRole("alert").filter({ hasText: "The message may have been sent" });
  await expect(alert).toBeVisible();
  await expect(alert.getByRole("button", { name: "Try again" })).toHaveCount(0);
  await expect(area(page)).toHaveValue("Maybe sent");
});

test("WhatsApp: an unconfirmed message says it may have been sent; one that went to another chat says so", async ({ page }) => {
  for (const [code, status, title, text] of [["send_unconfirmed", 504, "The message may have been sent", "WhatsApp did not show the message in this chat. It may have been sent: check the conversation before sending again."], ["whatsapp_wrong_chat", 502, "The message went to a different chat", "The message went to a different WhatsApp chat than the one you chose. Open WhatsApp and check it."]] as const) {
    await page.route("**/api/send", (r) => json(r, { error: { code, message: text, requestId: "r", retryable: false } }, status));
    await open(page);
    await area(page).fill("Hello");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Send", exact: true }).click();
    const alert = page.getByRole("alert").filter({ hasText: title });
    await expect(alert).toContainText(text);
    await expect(alert.getByRole("button", { name: "Try again" })).toHaveCount(0);
    await page.unroute("**/api/send");
  }
});

test("a lost answer keeps the attempt id: asking again replays it instead of sending twice", async ({ page }) => {
  const ids: string[] = [];
  let first = true;
  await page.route("**/api/send", async (r) => {
    ids.push(JSON.parse(r.request().postData() ?? "{}").clientId);
    if (first) { first = false; const res = await r.fetch(); void res; return r.abort("connectionreset"); } // the service sent it, the answer was lost
    return r.fallback();
  });
  await open(page);
  await area(page).fill("Once only");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Send", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "was not sent" }).getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("Sent through Messages to +36301234567.")).toBeVisible();
  expect(ids[0]).toBe(ids[1]);
  expect(sentLog(), "one message, however often it was asked for").toHaveLength(1);
});

test("a11y gate: the composer with Send, in light and dark and at 375 px", async ({ page }) => {
  await page.goto(`${svc.url}/inbox`);
  const href = await phone(page).getAttribute("href");
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `${svc.url}${href}`);
    await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible();
  }
  await page.setViewportSize({ width: 375, height: 800 });
  await expectAccessible(page, `${svc.url}${href}`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test.describe("sending turned off", () => {
  test.beforeEach(async () => { await svc.stop(); svc = await startService({ seed: true, env: { REPLY_CORE_SENDING: "off" } }); });
  test("there is no Send button, the reason is said, and opening the app still works", async ({ page }) => {
    await open(page);
    await expect(page.getByRole("button", { name: "Send", exact: true })).toHaveCount(0);
    await expect(page.getByText(/Sending is turned off/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Open in Messages" })).toBeVisible();
  });
});
