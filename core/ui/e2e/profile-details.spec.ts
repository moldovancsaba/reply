import { expect, test, type Page, type Route } from "@playwright/test";
import { expectAccessible, expectAccessibleNow } from "./a11y";
import { startService, type Service } from "./service";

let svc: Service;
test.beforeEach(async () => { svc = await startService({ seed: true }); });
test.afterEach(async () => { await svc.stop(); });

const json = (r: Route, body: unknown, status = 200) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const phone = (p: Page) => p.getByRole("list", { name: "Conversations" }).getByRole("link").filter({ hasText: "+36301234567" });
const profile = (p: Page) => p.getByRole("region", { name: /^Profile of / });
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();

async function open(p: Page) {
  await p.setViewportSize({ width: 1440, height: 1000 });
  await p.goto(`${svc.url}/inbox`);
  await phone(p).click();
  await expect(profile(p)).toBeVisible();
}

test("the profile shows facts computed from the messages: counts, first and last contact, channels", async ({ page }) => {
  await open(page);
  const facts = page.getByRole("list", { name: "Messages by channel" });
  await expect(profile(page).getByText("3 (2 received, 1 sent)")).toBeVisible();
  await expect(facts).toContainText("iMessage");
  await expect(facts).toContainText("3 messages (2 received, 1 sent)");
  await expect(profile(page).getByText("In touch since")).toBeVisible();
  await expect(profile(page).getByText("Last 30 days")).toBeVisible();
  await expect(page.getByRole("list", { name: "Phone numbers and addresses" })).toContainText("+36 30 123 4567");
  await expect(page.getByRole("list", { name: "Phone numbers and addresses" })).toContainText("3 messages");
  await expect(profile(page).getByText("Created automatically from messages")).toBeVisible();
});

test("details you add are saved on this Mac, validated, and survive a reload", async ({ page }) => {
  await open(page);
  const save = profile(page).getByRole("button", { name: "Save" });
  await expect(save).toBeDisabled();
  await page.getByLabel("Profession").fill("Designer");
  await page.getByLabel("Company").fill("Acme Ltd");
  await page.getByLabel("Relationship").fill("Client");
  await page.getByLabel("LinkedIn address").fill("javascript:alert(1)");
  await save.click();
  await expect(profile(page).getByRole("alert")).toContainText("web address");
  await page.getByLabel("LinkedIn address").fill("https://www.linkedin.com/in/anna");
  await page.getByLabel("Intro").fill("Met at the design fair.\nLikes email.");
  await save.click();
  await expect(page.getByText("Profile saved.")).toBeVisible();
  await expect(profile(page).getByText("Designer at Acme Ltd")).toBeVisible();
  await expect(profile(page).getByText("Client", { exact: true }).first()).toBeVisible();
  await expect(profile(page).getByRole("link", { name: "LinkedIn profile" })).toHaveAttribute("href", "https://www.linkedin.com/in/anna");
  await page.reload();
  await expect(page.getByLabel("Profession")).toHaveValue("Designer");
  await expect(page.getByLabel("Intro")).toHaveValue("Met at the design fair.\nLikes email.");
});

test("notes: add, list newest first, delete only after a confirmation", async ({ page }) => {
  await open(page);
  await page.getByLabel("Add a note").fill("Prefers email over phone");
  await profile(page).getByRole("button", { name: "Add note" }).click();
  await expect(profile(page).getByRole("list", { name: "Notes" })).toContainText("Prefers email over phone");
  await page.getByLabel("Add a note").fill("Birthday gift idea: book");
  await profile(page).getByRole("button", { name: "Add note" }).click();
  const items = profile(page).getByRole("list", { name: "Notes" }).getByRole("listitem");
  await expect(items).toHaveCount(2);
  await expect(items.first()).toContainText("Birthday gift idea");
  await items.first().getByRole("button", { name: "Delete note" }).click();
  await expect(page.getByRole("dialog")).toContainText("permanently deletes the note");
  await expect(items).toHaveCount(2);
  await page.keyboard.press("Escape");
  await expect(items).toHaveCount(2);
  await items.first().getByRole("button", { name: "Delete note" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete note" }).click();
  await expect(items).toHaveCount(1);
  await page.reload();
  await expect(profile(page).getByRole("list", { name: "Notes" }).getByRole("listitem")).toHaveCount(1);
});

test("address-book details are shown read-only, and only web links that are safe become links", async ({ page }) => {
  await page.route(/\/api\/contacts\/[^/]+\/profile$/, async (r) => {
    if (r.request().method() !== "GET") return r.fallback();
    const res = await r.fetch();
    const body = await res.json();
    body.card = { givenName: "Anna", familyName: "Kovacs", nickname: "Annie", organization: "Acme Ltd", jobTitle: "CFO", department: "Finance", birthday: "1985-03-09", urls: ["https://acme.example", "javascript:alert(1)"], addresses: ["1 Main Street, Budapest"] };
    body.origin = "apple_contacts";
    return json(r, body);
  });
  await open(page);
  const book = profile(page);
  await expect(book.getByText("Anna Kovacs", { exact: true })).toBeVisible();
  await expect(book.getByText("Annie")).toBeVisible();
  await expect(book.getByText("CFO at Acme Ltd")).toBeVisible();
  await expect(book.getByText("Finance")).toBeVisible();
  await expect(book.getByText(/March 9, 1985|9 March 1985/)).toBeVisible();
  await expect(book.getByText("1 Main Street, Budapest")).toBeVisible();
  await expect(book.getByRole("link", { name: "https://acme.example" })).toHaveAttribute("rel", /noopener/);
  await expect(book.getByRole("link", { name: /javascript/ })).toHaveCount(0);
  await expect(book.getByText("javascript:alert(1)")).toBeVisible();
});

test("the profile column can be hidden, the choice is remembered; on a narrow window it is its own page", async ({ page }) => {
  await open(page);
  const toggle = page.getByRole("button", { name: "Hide profile" });
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await toggle.click();
  await expect(profile(page)).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "Show profile" })).toBeVisible();
  await expect(profile(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Show profile" }).click();
  await expect(profile(page)).toBeVisible();

  await page.setViewportSize({ width: 375, height: 800 });
  await expect(profile(page)).toHaveCount(0);
  await page.getByRole("link", { name: "Profile", exact: true }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(profile(page)).toBeVisible();
  await page.getByRole("link", { name: "Back to conversation", exact: true }).click();
  await expect(page.getByRole("log")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("a11y gate: the profile with address-book data in light and dark, and at 375 px", async ({ page }) => {
  await page.route(/\/api\/contacts\/[^/]+\/profile$/, async (r) => {
    if (r.request().method() !== "GET") return r.fallback();
    const body = await (await r.fetch()).json();
    body.card = { givenName: "Anna", familyName: "Kovacs", organization: "Acme Ltd", jobTitle: "CFO", birthday: "--03-09", urls: ["https://acme.example"], addresses: ["1 Main Street, Budapest"] };
    body.notes = [{ id: "n1", text: "Prefers email", createdAt: iso(2) }];
    return json(r, body);
  });
  await page.goto(`${svc.url}/inbox`);
  const href = await phone(page).getAttribute("href");
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `${svc.url}${href}/profile`);
    await expect(profile(page)).toBeVisible();
  }
  await page.setViewportSize({ width: 375, height: 800 });
  await expectAccessible(page, `${svc.url}${href}/profile`);
  await expectAccessibleNow(page, "profile narrow");
});
