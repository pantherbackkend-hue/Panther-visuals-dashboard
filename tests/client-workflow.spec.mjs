import { test, expect } from "@playwright/test";

const USERS = {
  admin: { email: "admin@test.com", password: "password123" },
};

async function login(page, user) {
  await page.goto("/login");
  await page.waitForSelector("input[name=email]", { timeout: 5000 });
  await page.fill("input[name=email]", user.email);
  await page.fill("input[name=password]", user.password);
  await page.click("button.btn--full");
  await page.waitForLoadState("networkidle");
}

async function goToNewProject(page) {
  await login(page, USERS.admin);
  await page.goto("/admin/projects/new");
  await page.waitForLoadState("networkidle");
}

async function selectClientInCombobox(page, clientName) {
  await page.click("#clientComboInput");
  await page.locator("#clientListbox li", { hasText: clientName }).click();
}

test.describe("Client Dropdown UX", () => {
  test("Rows render client name and project count", async ({ page }) => {
    await goToNewProject(page);
    await page.click("#clientComboInput");
    const row = page.locator("#clientListbox li", { hasText: "Test Client Inc" });
    await expect(row).toBeVisible();
    await expect(row.locator(".combo-client-name")).toHaveText("Test Client Inc");
    await expect(row.locator(".combo-proj-count")).toHaveText("1 Project");
  });

  test("Search filters clients by name", async ({ page }) => {
    await goToNewProject(page);
    await page.fill("#clientComboInput", "Test Client");
    await expect(page.locator("#clientListbox li", { hasText: "Test Client Inc" })).toBeVisible();
    await expect(page.locator("#clientListbox li")).toHaveCount(1);
  });

  test("Empty search shows empty state message", async ({ page }) => {
    await goToNewProject(page);
    await page.fill("#clientComboInput", "zzzz-nothing-matches");
    await expect(page.locator("#clientListbox .combo-empty")).toHaveText(
      "No clients found. Create a new client.",
    );
  });

  test("Hover state is readable (high contrast)", async ({ page }) => {
    await goToNewProject(page);
    await page.click("#clientComboInput");
    const row = page.locator("#clientListbox li", { hasText: "Test Client Inc" });
    await row.hover();
    await expect(row).toHaveClass(/is-highlighted/);
    const styles = await row.evaluate((el) => {
      const s = getComputedStyle(el);
      return { background: s.backgroundColor, color: s.color };
    });
    expect(styles.background).toBe("rgb(239, 246, 255)");
    expect(styles.color).toBe("rgb(15, 23, 42)");
  });

  test("Selected client state is visible and captured in form", async ({ page }) => {
    await goToNewProject(page);
    await page.click("#clientComboInput");
    await page.locator("#clientListbox li", { hasText: "Test Client Inc" }).click();
    const hiddenInput = page.locator("#clientId");
    await expect(hiddenInput).not.toHaveValue("");
    await expect(page.locator("#clientComboInput")).toHaveValue("Test Client Inc");
    await expect(page.locator("#existingClientInfo")).toContainText("Test Client Inc");
    await expect(page.locator("#existingClientInfo")).toContainText("1");
    await expect(page.locator("#clientName")).toHaveValue("Test Client Inc");
  });
});

test.describe("Existing Client Flow", () => {
  test("Project created with existing client and linked to client", async ({ page }) => {
    await goToNewProject(page);
    await page.click("#clientComboInput");
    await page.locator("#clientListbox li", { hasText: "Test Client Inc" }).click();
    await page.fill("input[name=projectName]", "PW Existing Client Project");
    await page.fill("input[name=projectFilesLink]", "https://drive.google.com/pw-existing-files");
    await page.click("form.admin-form button[type=submit]");
    await page.waitForLoadState("networkidle");
    await expect(page.locator(".flash--success")).toContainText("created");
    expect(page.url()).toContain("/admin/projects/");

    await page.goto("/admin/clients");
    await page.locator("a.admin-link", { hasText: "Test Client Inc" }).click();
    await page.waitForLoadState("networkidle");
    await expect(page.locator("body")).toContainText("PW Existing Client Project");
  });
});

test.describe("New Client Flow", () => {
  test("Project creation creates client inline and links project", async ({ page }) => {
    await goToNewProject(page);
    await page.check('input[name="clientMode"][value="new"]');
    await page.fill("input[name=clientName]", "PW Inline Client");
    await page.fill("textarea[name=clientReferenceAssets]", "PW Brand kit drive link");
    await page.fill("textarea[name=clientNotes]", "PW inline client notes");
    await page.fill("input[name=projectName]", "PW Inline Client Project");
    await page.fill("input[name=projectFilesLink]", "https://drive.google.com/pw-inline-files");
    await page.click("form.admin-form button[type=submit]");
    await page.waitForLoadState("networkidle");
    await expect(page.locator(".flash--success")).toContainText("created");
    expect(page.url()).toContain("/admin/projects/");

    await page.goto("/admin/clients");
    await page.locator("a.admin-link", { hasText: "PW Inline Client" }).click();
    await page.waitForLoadState("networkidle");
    await expect(page.locator("body")).toContainText("PW Brand kit drive link");
    await expect(page.locator("body")).toContainText("PW inline client notes");
    await expect(page.locator("body")).toContainText("PW Inline Client Project");
    await expect(page.locator("#projects")).toContainText("PW Inline Client Project");
  });

  test("New client fields do not include email or channel fields", async ({ page }) => {
    await goToNewProject(page);
    await page.check('input[name="clientMode"][value="new"]');
    await expect(page.locator("textarea[name=clientReferenceAssets]")).toBeVisible();
    await expect(page.locator("textarea[name=clientNotes]")).toBeVisible();
    await expect(page.locator("input[name=clientEmail]")).toHaveCount(0);
    await expect(page.locator("input[name=channelName]")).toHaveCount(0);
    await expect(page.locator("input[name=channelUrl]")).toHaveCount(0);
    await expect(page.locator("input[name=clientPhone]")).toHaveCount(0);
  });
});

test.describe("Validation", () => {
  test("Client name is required in new client mode", async ({ page }) => {
    await goToNewProject(page);
    await page.check('input[name="clientMode"][value="new"]');
    await page.evaluate(() => {
      document.querySelector("input[name=projectName]").value = "PW No Client Name";
      document.querySelector("form.admin-form").submit();
    });
    await page.waitForLoadState("networkidle");
    await expect(page.locator(".flash--error")).toContainText("Client name is required.");
  });
});

test.describe("Client Management", () => {
  test("Table shows reference assets and notes, no email or channel columns", async ({ page }) => {
    await login(page, USERS.admin);
    await page.goto("/admin/clients");
    await page.waitForLoadState("networkidle");
    const headers = await page.locator("table thead th").allInnerTexts();
    expect(headers).toContain("Reference Assets");
    expect(headers).toContain("Notes");
    expect(headers).toContain("Projects");
    expect(headers).toContain("Created By");
    expect(headers).not.toContain("Email");
    expect(headers.join(" ")).not.toMatch(/Channel/i);
    await expect(page.locator("tbody")).toContainText("Test client notes");
  });

  test("Client form has no email or channel fields", async ({ page }) => {
    await login(page, USERS.admin);
    await page.goto("/admin/clients/new");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("input[name=email]")).toHaveCount(0);
    await expect(page.locator("input[name=channelName]")).toHaveCount(0);
    await expect(page.locator("input[name=channelUrl]")).toHaveCount(0);
    await expect(page.locator("textarea[name=referenceAssets]")).toBeVisible();
    await expect(page.locator("textarea[name=notes]")).toBeVisible();
  });

  test("Client detail page shows reference assets, notes, and projects", async ({ page }) => {
    await login(page, USERS.admin);
    await page.goto("/admin/clients");
    await page.locator("a.admin-link", { hasText: "Test Client Inc" }).click();
    await page.waitForLoadState("networkidle");
    await expect(page.locator("body")).toContainText("Test client notes");
    await expect(page.locator("#projects")).toContainText("Standard Project");
  });
});
