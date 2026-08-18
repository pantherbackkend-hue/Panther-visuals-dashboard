import { test, expect } from "@playwright/test";

const USERS = {
  admin: { email: "admin@test.com", password: "password123" },
  editor: { email: "editor@test.com", password: "password123" },
  client: { email: "client@test.com", password: "password123" },
};

async function login(page, user) {
  await page.goto("/login");
  await page.waitForSelector("input[name=email]", { timeout: 5000 });
  await page.fill("input[name=email]", user.email);
  await page.fill("input[name=password]", user.password);
  await page.click("button.btn--full");
  await page.waitForLoadState("networkidle");
}

async function loginViaRequest(page, user) {
  // ponytail: bypasses the client landing-page redirect loop (client "/" -> "/")
  const response = await page.request.post("/login", {
    form: { email: user.email, password: user.password },
    maxRedirects: 0,
  });
  expect([302, 200]).toContain(response.status());
}

async function createTutorial(page, { title, description, videoUrl }) {
  await login(page, USERS.admin);
  await page.goto("/admin/tutorials/new");
  await page.waitForLoadState("networkidle");
  await page.fill("#title", title);
  await page.fill("#description", description || "");
  await page.fill("#videoUrl", videoUrl);
  await page.click("form.admin-form button[type=submit]");
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".flash--success")).toContainText("Tutorial created");
}

function rowByName(page, title) {
  return page.locator("tbody tr", { hasText: title });
}

test.describe("Admin: Create", () => {
  test("admin creates a tutorial with any link; form has no optional fields", async ({ page }) => {
    await login(page, USERS.admin);
    await page.goto("/admin/tutorials/new");
    await page.waitForLoadState("networkidle");

    await expect(page.locator("#category")).toHaveCount(0);
    await expect(page.locator("#thumbnailUrl")).toHaveCount(0);
    await expect(page.locator("input[name=published]")).toHaveCount(0);
    await expect(page.locator("input[name=requiredForOnboarding]")).toHaveCount(0);

    await page.fill("#title", "Spec Drive Link");
    await page.fill("#description", "How to open the shared folder.");
    await page.fill("#videoUrl", "https://drive.google.com/drive/folders/abc123");
    await page.click("form.admin-form button[type=submit]");
    await page.waitForLoadState("networkidle");
    await expect(page.locator(".flash--success")).toContainText("Tutorial created");

    const row = rowByName(page, "Spec Drive Link");
    await expect(row).toHaveCount(1);
    await expect(row.getByRole("link", { name: "Edit" })).toBeVisible();
    await expect(row.getByRole("button", { name: "Delete" })).toBeVisible();
  });
});

test.describe("Admin: Edit", () => {
  test("admin edits title and link", async ({ page }) => {
    await createTutorial(page, {
      title: "Spec Edit Tutorial",
      videoUrl: "https://docs.google.com/document/d/xyz/edit",
    });

    await rowByName(page, "Spec Edit Tutorial").getByRole("link", { name: "Edit" }).click();
    await page.waitForLoadState("networkidle");
    await expect(page.locator("input[name=published]")).toHaveCount(0);
    await page.fill("#title", "Spec Edit Tutorial v2");
    await page.fill("#videoUrl", "https://www.notion.so/Renamed-Page-9876");
    await page.click("form.admin-form button[type=submit]");
    await page.waitForLoadState("networkidle");
    await expect(page.locator(".flash--success")).toContainText("Tutorial updated");
    await expect(rowByName(page, "Spec Edit Tutorial v2")).toHaveCount(1);
  });
});

test.describe("Admin: Delete", () => {
  test("admin deletes a tutorial after confirm", async ({ page }) => {
    await createTutorial(page, {
      title: "Spec Delete Tutorial",
      videoUrl: "https://vimeo.com/123456789",
    });

    page.on("dialog", (dialog) => dialog.accept());
    await rowByName(page, "Spec Delete Tutorial").getByRole("button", { name: "Delete" }).click();
    await page.waitForLoadState("networkidle");
    await expect(page.locator(".flash--success")).toContainText("Tutorial deleted");
    await expect(page.locator("tbody tr", { hasText: "Spec Delete Tutorial" })).toHaveCount(0);
  });
});

test.describe("Editor: Browse", () => {
  test("editor sees tutorial cards that open the link in a new tab", async ({ page }) => {
    await login(page, USERS.editor);
    await page.goto("/editor/tutorials");
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("Getting Started with the Dashboard")).toBeVisible();
    await expect(page.getByText("Advanced Color Grading")).toBeVisible();

    const openButton = page
      .locator(".card", { hasText: "Getting Started with the Dashboard" })
      .getByRole("link", { name: "Open Tutorial" });
    await expect(openButton).toHaveAttribute("href", "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    await expect(openButton).toHaveAttribute("target", "_blank");

    const popupPromise = page.waitForEvent("popup");
    await openButton.click();
    const popup = await popupPromise;
    expect(popup.url()).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    await popup.close();

    await expect(page.locator("iframe")).toHaveCount(0);
  });
});

test.describe("Access control", () => {
  test("client is blocked from admin tutorial pages", async ({ page }) => {
    await loginViaRequest(page, USERS.client);
    const res = await page.request.get("/admin/tutorials", { maxRedirects: 0 });
    expect(res.status()).toBe(302);
    expect(res.headers().location).toBe("/");
  });

  test("client is blocked from editor tutorial pages", async ({ page }) => {
    await loginViaRequest(page, USERS.client);
    const res = await page.request.get("/editor/tutorials", { maxRedirects: 0 });
    expect(res.status()).toBe(302);
    expect(res.headers().location).toBe("/");
  });

  test("anonymous users are redirected to login", async ({ page }) => {
    await page.goto("/admin/tutorials");
    await page.waitForLoadState("networkidle");
    expect(page.url()).toContain("/login");

    await page.goto("/editor/tutorials");
    await page.waitForLoadState("networkidle");
    expect(page.url()).toContain("/login");
  });
});