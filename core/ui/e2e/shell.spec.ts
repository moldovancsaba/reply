import { expect, test } from "@playwright/test";
import { expectAccessible, expectAccessibleNow } from "./a11y";
import { startService, type Service } from "./service";

let svc: Service;
test.beforeAll(async () => { svc = await startService(); });
test.afterAll(async () => { await svc.stop(); });

const TAB_ORDER = ['a[href="#main-content"]', 'nav a[href="/inbox"]', 'nav a[href="/search"]', 'nav a[href="/sources"]'];

test("the service serves the app with a strict content security policy", async ({ request }) => {
  const r = await request.get(`${svc.url}/inbox/abc`, { headers: { accept: "text/html" } });
  expect(r.status()).toBe(200);
  expect(r.headers()["content-security-policy"]).toContain("script-src 'self'");
  expect(r.headers()["cache-control"]).toBe("no-cache");
});

test("every route renders in the shell with the right heading and active destination", async ({ page }) => {
  const errors: string[] = [];
  // an unknown contact (/inbox/c_123) is a deliberate 404
  page.on("console", (m) => { if (m.type() === "error" && !/status of 404/.test(m.text())) errors.push(m.text()); });
  await page.goto(`${svc.url}/`);
  await expect(page).toHaveURL(/\/inbox$/);
  for (const [path, heading, nav] of [["/inbox", "Inbox", "Inbox"], ["/inbox/c_123", "Inbox", "Inbox"], ["/search", "Search", "Search"], ["/sources", "Sources", "Sources"]] as const) {
    await page.goto(`${svc.url}${path}`);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(page.locator("nav a[aria-current='page']")).toHaveText(nav);
    await expect(page.getByText(/Running v/)).toBeVisible();
  }
  expect(errors, errors.join("\n")).toEqual([]);
});

test("sidebar navigation, back and forward keep the page and the active item in step", async ({ page }) => {
  await page.goto(`${svc.url}/inbox`);
  await page.locator("nav a[href='/search']").click();
  await expect(page).toHaveURL(/\/search$/);
  await expect(page.locator("nav a[aria-current='page']")).toHaveText("Search");
  await page.locator("nav a[href='/sources']").click();
  await expect(page.getByRole("heading", { level: 1, name: "Sources" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "Search" })).toBeVisible();
  await expect(page.locator("nav a[aria-current='page']")).toHaveText("Search");
  await page.goForward();
  await expect(page.locator("nav a[aria-current='page']")).toHaveText("Sources");
});

test("an unknown page says so and offers a way back", async ({ page }) => {
  await page.goto(`${svc.url}/definitely-not-here`);
  await expect(page.getByText("This page does not exist")).toBeVisible();
  await page.getByRole("button", { name: /Go to Inbox/ }).click();
  await expect(page).toHaveURL(/\/inbox$/);
});

test("the skip link is the first tab stop and moves focus to the content", async ({ page }) => {
  await page.goto(`${svc.url}/inbox`);
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
});

for (const scheme of ["light", "dark"] as const) {
  for (const route of ["/inbox", "/inbox/c_123", "/search", "/sources", "/not-a-page"]) {
    test(`accessibility gate: ${route} (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await expectAccessible(page, `${svc.url}${route}`, route === "/inbox" && scheme === "light" ? TAB_ORDER : undefined);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    });
  }
}

test("at 375 px the navigation is reachable, nothing scrolls sideways", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${svc.url}/inbox`);
  await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.locator("nav a[href='/sources']").first()).toBeVisible();
  await page.locator("nav a[href='/sources']").first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Sources" })).toBeVisible();
  await expectAccessibleNow(page, "/sources (375px)");
});

test("a 200% zoom (320 px wide) and reduced motion still work without clipping", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(`${svc.url}/inbox`);
  await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test("the not-running banner appears within a minute of the service stopping and clears when it returns", async ({ page }) => {
  await page.clock.install();
  await page.goto(`${svc.url}/inbox`);
  await expect(page.getByText(/Running v/)).toBeVisible();
  await svc.stop();
  await page.clock.runFor(40_000);
  const banner = page.getByRole("alert").filter({ hasText: "Reply Core is not running" });
  await expect(banner).toBeVisible();
  await expect(page.getByText("Not running", { exact: true })).toBeVisible();
  await expectAccessibleNow(page, "/inbox (service down)");
  await svc.start();
  await page.getByRole("button", { name: /Retry now/ }).click();
  await expect(page.getByText(/Running v/)).toBeVisible();
  await expect(banner).toBeHidden();
});
