import { expect, test } from "@playwright/test";
import { expectAccessible, expectAccessibleNow, expectFocusTrapped } from "./a11y";
import { startService, type Service } from "./service";

let svc: Service;
test.beforeEach(async () => { svc = await startService({ seed: true }); });
test.afterEach(async () => { await svc.stop(); });

const rows = (p: import("@playwright/test").Page) => p.getByRole("list", { name: "Conversations" }).getByRole("link");

test("profile column lists handles; merge needs a confirmation, sends one request, joins the timelines; undo restores", async ({ page }) => {
  const posts: string[] = [];
  page.on("request", (r) => { if (r.method() === "POST") posts.push(r.url().replace(svc.url, "")); });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${svc.url}/inbox`);
  await expect(rows(page)).toHaveCount(2);
  await rows(page).filter({ hasText: "+36301234567" }).click();
  await expect(page.getByRole("log").getByRole("article")).toHaveCount(3);
  await expect(page.getByRole("list", { name: "Phone numbers and addresses" })).toBeVisible(); // the profile column is open by default on a wide window
  await expect(page.getByText("No merges yet.")).toBeVisible();
  await expectAccessibleNow(page, "profile");

  // pick the other contact: nothing is sent until the dialog is confirmed
  await page.getByRole("button", { name: /^Search for a contact to merge/ }).click();
  await page.getByRole("option", { name: /anna@example.com/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Move 1 handle and 2 messages from anna@example.com into +36301234567?");
  expect(posts).toEqual([]);
  await page.waitForTimeout(600); // let the dialog finish fading in, or contrast is measured mid-transition
  await expectAccessibleNow(page, "merge dialog");
  await expectFocusTrapped(page, "[role=dialog]", "merge dialog");

  await dialog.getByRole("button", { name: "Merge" }).dblclick();
  await expect(page.getByRole("log").getByRole("article")).toHaveCount(5);
  expect(posts.filter((u) => u.endsWith("/merge"))).toHaveLength(1);
  await expect(page).toHaveURL(/\/inbox\/[^/]+$/);
  await expect(rows(page)).toHaveCount(1);
  await expect(page.getByText("Merged anna@example.com into +36301234567.")).toBeVisible();

  // undo from the toast: it leads to its own confirmation
  await page.getByRole("button", { name: "Undo" }).first().click(); // the notice comes before the page content
  await expect(page).toHaveURL(/profile\?undo=/);
  await expect(page.getByRole("dialog")).toContainText("Make anna@example.com a separate contact again");
  await page.getByRole("dialog").getByRole("button", { name: "Undo merge" }).click();
  await expect(rows(page)).toHaveCount(2);
  await expect(page.getByText("Undone: anna@example.com is a separate contact again.")).toBeVisible();
  const history = page.getByRole("list", { name: "Merge history" });
  await expect(history.getByRole("listitem")).toHaveCount(2);
  await expect(history).toContainText("Undid the merge");
  await expect(history).toContainText("· undone");
  await expect(history.getByRole("button", { name: "Undo" })).toHaveCount(0);
});

test("a failed merge stays in the dialog with a plain explanation", async ({ page }) => {
  await page.route(/\/merge$/, (r) => r.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: { code: "handle_conflict", message: "x", requestId: "r", retryable: false, details: { handles: ["anna@example.com"] } } }) }));
  await page.goto(`${svc.url}/inbox`);
  await rows(page).first().click();
  await page.getByRole("button", { name: /^Search for a contact to merge/ }).click();
  await page.getByRole("option").first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Merge" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("A handle was moved elsewhere since this merge (anna@example.com)");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^(Search for a contact to merge|\+36301234567|anna@example\.com)/ }), "focus returns to the control that opened the dialog").toBeFocused();
});

test("picker with no match says so", async ({ page }) => {
  await page.goto(`${svc.url}/inbox`);
  await rows(page).first().click();
  await page.getByRole("button", { name: /^Search for a contact to merge/ }).click();
  await page.getByRole("textbox", { name: "Search for a contact to merge" }).fill("zzzzzz");
  await expect(page.getByText("No contacts match")).toBeVisible();
});

test("a11y gate: profile in light and dark, and at phone width", async ({ page }) => {
  await page.goto(`${svc.url}/inbox`);
  const href = await rows(page).first().getAttribute("href");
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `${svc.url}${href}/profile`);
    await expect(page.getByText("Merge history")).toBeVisible();
  }
  await page.setViewportSize({ width: 375, height: 800 });
  await expectAccessible(page, `${svc.url}${href}/profile`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
