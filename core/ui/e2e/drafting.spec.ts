import { expect, test, type Page, type Route } from "@playwright/test";
import { expectAccessible, expectAccessibleNow, expectFocusTrapped } from "./a11y";
import { fakeOllama, type Fake } from "./fakeOllama";
import { startService, type Service } from "./service";

let svc: Service;
let fake: Fake;
const json = (r: Route, body: unknown, status = 200) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

test.beforeEach(async ({}, info) => {
  fake = await fakeOllama();
  const on = !info.title.includes("[off]");
  svc = await startService({ seed: true, env: on ? { REPLY_CORE_LLM: "ollama", REPLY_CORE_OLLAMA_MODEL: "fake:1", REPLY_CORE_OLLAMA_URL: fake.url } : {} });
});
test.afterEach(async () => { await svc.stop(); await fake.close(); });

const phone = (p: Page) => p.getByRole("list", { name: "Conversations" }).getByRole("link").filter({ hasText: "+36301234567" });
const area = (p: Page) => p.getByLabel("Message", { exact: true });
const suggest = (p: Page) => p.getByRole("button", { name: "Suggest a reply" });
async function openThread(p: Page) { await p.goto(`${svc.url}/inbox`); await phone(p).click(); await expect(suggest(p)).toBeVisible(); }

test("[on] suggest, review with the AI label, insert into an empty composer; the draft is never stored", async ({ page }) => {
  fake.behave.delayMs = 400;
  await openThread(page);
  await expect(suggest(page)).toBeEnabled();
  await page.getByLabel("What should the reply say? (optional)").fill("say yes");
  await suggest(page).click();
  await expect(page.getByRole("status").filter({ hasText: "Writing a draft with fake:1…" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
  const region = page.getByRole("region", { name: "Suggested reply (AI-generated). Review before sending." });
  await expect(region).toBeVisible();
  await expect(region).toContainText("AI-generated draft. Review before sending.");
  await expect(region).toContainText("Yes, 6 works. Where should we meet?");
  await expect(region).toBeFocused();
  expect(String(fake.seen.generate[0].prompt)).toContain("say yes");
  expect(await area(page).inputValue(), "never inserted on its own").toBe("");
  const stored = await page.evaluate(() => JSON.stringify({ ...sessionStorage }) + JSON.stringify({ ...localStorage }));
  expect(stored).not.toContain("Where should we meet");
  await page.getByRole("button", { name: "Insert" }).click();
  await expect(area(page)).toHaveValue("Yes, 6 works. Where should we meet?");
  await expect(area(page)).toBeFocused();
  await expect(region).toHaveCount(0);
});

test("[on] with typed text, Insert asks replace or append in a focus-trapping dialog; both choices and Cancel work", async ({ page }) => {
  await openThread(page);
  await area(page).fill("Mine");
  await suggest(page).click();
  await page.getByRole("button", { name: "Insert" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("You already wrote something");
  await page.waitForTimeout(600);
  await expectAccessibleNow(page, "insert dialog");
  await expectFocusTrapped(page, "[role=dialog]", "insert dialog");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(area(page)).toHaveValue("Mine");
  await page.getByRole("button", { name: "Insert" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Add below my text" }).click();
  await expect(area(page)).toHaveValue("Mine\n\nYes, 6 works. Where should we meet?");
  await suggest(page).click();
  await page.getByRole("button", { name: "Insert" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Replace my text" }).click();
  await expect(area(page)).toHaveValue("Yes, 6 works. Where should we meet?");
});

test("[on] Regenerate asks again; Discard and Cancel abort the model call; leaving the page aborts too", async ({ page, browserName }) => {
  // WebKit does not always close the connection of an aborted fetch at once, so the model sometimes keeps going until its own
  // timeout; the UI side of Cancel is still checked there, the count of aborted model calls only in Chrome.
  const aborted = (n: number) => browserName === "webkit" ? Promise.resolve() : expect.poll(() => fake.seen.aborted).toBe(n);
  await openThread(page);
  await suggest(page).click();
  await expect(page.getByRole("button", { name: "Regenerate" })).toBeVisible();
  fake.behave.response = "Second try.";
  await page.getByRole("button", { name: "Regenerate" }).click();
  await expect(page.getByText("Second try.")).toBeVisible();
  expect(fake.seen.generate).toHaveLength(2);
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(page.getByText("Second try.")).toHaveCount(0);

  fake.behave.hang = true;
  await suggest(page).click();
  await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
  await expect.poll(() => fake.seen.generate.length).toBe(3); // the model has the request: cancelling earlier would abort nothing upstream
  await page.getByRole("button", { name: "Cancel" }).click();
  await aborted(1);
  await expect(page.getByRole("button", { name: "Cancel" })).toHaveCount(0);
  if (browserName === "webkit") return; // a new suggestion would be refused ("a draft is already being written") while the aborted one is still held

  await suggest(page).click();
  await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
  await expect.poll(() => fake.seen.generate.length).toBe(4);
  await page.locator("nav a[href='/search']").click();
  await aborted(2);
});

test("[on] every service error code has plain copy, the composer text is untouched, and errors are alerts", async ({ page }) => {
  const codes: [string, number, boolean, RegExp][] = [
    ["drafting_disabled", 409, false, /Drafting is turned off\. Enable a local model to use it\./],
    ["model_unavailable", 503, true, /The local model is not reachable\. Start Ollama and try again\./],
    ["model_unavailable", 503, false, /ollama pull fake:1/],
    ["draft_timeout", 504, true, /The model took too long\. Try again or write the reply yourself\./],
    ["empty_draft", 422, false, /The model returned nothing\. Try again\./],
    ["draft_busy", 429, true, /A draft is already being written\./],
    ["contact_not_found", 404, false, /no longer exists/],
  ];
  await openThread(page);
  await area(page).fill("Keep this");
  for (const [code, status, retryable, copy] of codes) {
    await page.route("**/api/drafts/suggest", (r) => json(r, { error: { code, message: "Run: ollama pull fake:1", requestId: "r", retryable } }, status));
    await suggest(page).click();
    await expect(page.getByRole("alert")).toContainText(copy);
    await expect(area(page)).toHaveValue("Keep this");
    await page.unroute("**/api/drafts/suggest");
  }
  await expectAccessibleNow(page, "draft error");
});

test("[off] drafting off: the button is disabled with an explanation, never hidden and never an error", async ({ page }) => {
  await page.goto(`${svc.url}/inbox`);
  await phone(page).click();
  await expect(suggest(page)).toBeDisabled();
  await expect(page.getByText(/Drafting is turned off\. To use it, install Ollama/)).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expectAccessibleNow(page, "drafting off");
});

test("[on] capabilities are asked again when the window regains focus", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/drafts/capabilities", (r) => { calls += 1; return r.fallback(); });
  await openThread(page);
  await expect(suggest(page)).toBeEnabled();
  const before = calls;
  await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
  await expect.poll(() => calls).toBeGreaterThan(before);
});

test("[on] a11y gate: loading, ready and error states in light and dark, ready at 375 px", async ({ page }) => {
  await page.goto(`${svc.url}/inbox`);
  const href = await phone(page).getAttribute("href");
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `${svc.url}${href}`);
    await expect(suggest(page)).toBeEnabled();
    fake.behave.hang = true;
    await suggest(page).click();
    await expect(page.getByRole("status").filter({ hasText: "Writing a draft" })).toBeVisible();
    await expectAccessibleNow(page, `draft loading ${scheme}`);
    await page.getByRole("button", { name: "Cancel" }).click();
    fake.behave.hang = false;
    await suggest(page).click();
    await expect(page.getByRole("region", { name: /Suggested reply/ })).toBeVisible();
    await expectAccessibleNow(page, `draft ready ${scheme}`);
  }
  await page.setViewportSize({ width: 375, height: 800 });
  await expectAccessible(page, `${svc.url}${href}`);
  await expect(suggest(page)).toBeEnabled();
  await suggest(page).click();
  await expect(page.getByRole("region", { name: /Suggested reply/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
