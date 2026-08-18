import { test, expect } from "@playwright/test";

const USERS = {
  editor: { email: "editor@test.com", password: "password123" },
};

async function login(page) {
  await page.goto("/login");
  await page.waitForSelector("input[name=email]", { timeout: 5000 });
  await page.fill("input[name=email]", USERS.editor.email);
  await page.fill("input[name=password]", USERS.editor.password);
  await page.click("button.btn--full");
  await page.waitForLoadState("networkidle");
}

test.describe("Editor workspace actions", () => {
  test("Tutorials is NOT in the hamburger nav on desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await login(page);
    await page.goto("/editor/projects");
    await page.waitForLoadState("networkidle");

    await expect(page.locator("nav#main-nav a[href='/editor/tutorials']")).toHaveCount(0);
  });

  test("Tutorials is NOT in the mobile hamburger nav", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
    await page.goto("/editor/projects");
    await page.waitForLoadState("networkidle");

    await expect(page.locator("nav#main-nav a[href='/editor/tutorials']")).toHaveCount(0);
  });

  test("Tutorials appears beside My Assets and opens /editor/tutorials", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await login(page);
    await page.goto("/editor/projects");
    await page.waitForLoadState("networkidle");

    const assets = page.locator(".admin-page-head a.btn[href='/editor/assets']");
    const tutorials = page.locator(".admin-page-head a.btn[href='/editor/tutorials']");

    await expect(assets).toBeVisible();
    await expect(tutorials).toBeVisible();
    await expect(tutorials).toHaveText("Tutorials");
    await expect(tutorials).toHaveClass(/btn--outline/);
    await expect(tutorials.getAttribute("class")).resolves.toBe(await assets.getAttribute("class"));
    await expect(tutorials.evaluate((el) => el.parentElement.className)).resolves.toBe("admin-actions");
    await expect(assets.evaluate((el) => el.parentElement.className)).resolves.toBe("admin-actions");

    await tutorials.click();
    await page.waitForLoadState("networkidle");
    expect(page.url()).toContain("/editor/tutorials");
    await expect(page.locator("h1")).toHaveText("Tutorials");
  });

  test("Tutorials button stays usable on mobile widths", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
    await page.goto("/editor/projects");
    await page.waitForLoadState("networkidle");

    const tutorials = page.locator(".admin-page-head a.btn[href='/editor/tutorials']");
    await expect(tutorials).toBeVisible();
    await expect(tutorials).toBeEnabled();
  });
});