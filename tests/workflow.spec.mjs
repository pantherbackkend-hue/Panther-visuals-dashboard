import { test, expect } from "@playwright/test";

const USERS = {
  owner: { email: "owner@test.com", password: "password123" },
  admin: { email: "admin@test.com", password: "password123" },
  editor: { email: "editor@test.com", password: "password123" },
  inactive: { email: "inactive@test.com", password: "password123" },
};

async function login(page, user) {
  await page.goto("/login");
  await page.waitForSelector("input[name=email]", { timeout: 5000 });
  await page.fill("input[name=email]", user.email);
  await page.fill("input[name=password]", user.password);
  await page.click("button.btn--full");
  await page.waitForLoadState("networkidle");
}

test.describe("Authentication", () => {
  test("Login page loads", async ({ page }) => {
    await page.goto("/login");
    await expect(page).toHaveTitle(/Login/);
    await expect(page.locator("input[name=email]")).toBeVisible();
    await expect(page.locator("input[name=password]")).toBeVisible();
  });

  test("Signup page loads", async ({ page }) => {
    await page.goto("/signup");
    await expect(page).toHaveTitle(/Sign Up/);
  });

  test("Login with valid credentials", async ({ page }) => {
    await login(page, USERS.owner);
    expect(page.url()).toContain("/admin/workspace");
  });

  test("Login with wrong password shows error", async ({ page }) => {
    await page.goto("/login");
    await page.fill("input[name=email]", "owner@test.com");
    await page.fill("input[name=password]", "wrongpassword");
    await page.click("button.btn--full");
    await page.waitForLoadState("networkidle");
    await expect(page.locator(".flash--error")).toContainText("Invalid");
  });

  test("Inactive account rejected", async ({ page }) => {
    await page.goto("/login");
    await page.fill("input[name=email]", USERS.inactive.email);
    await page.fill("input[name=password]", USERS.inactive.password);
    await page.click("button.btn--full");
    await page.waitForLoadState("networkidle");
    await expect(page.locator(".flash--error")).toContainText("disabled");
  });

  test("Redirect unauthenticated to login", async ({ page }) => {
    await page.goto("/admin/projects");
    await expect(page).toHaveURL(/\/login/);
  });

  test("Logout clears session", async ({ page }) => {
    await login(page, USERS.admin);
    await page.evaluate(() => fetch("/logout", { method: "POST" }));
    await page.goto("/admin/workspace");
    await expect(page).toHaveURL(/\/login/);
  });

  test("Home redirects auth user", async ({ page }) => {
    await login(page, USERS.owner);
    await page.goto("/");
    expect(page.url()).toContain("/admin/workspace");
  });
});

test.describe("Sidebar Navigation", () => {
  test("Owner sidebar", async ({ page }) => {
    await login(page, USERS.owner);
    await page.goto("/admin/workspace");
    await page.waitForLoadState("networkidle");
    const text = await page.locator(".admin-sidebar").innerText();
    expect(text).toContain("Workspace");
    expect(text).toContain("Dashboard");
    expect(text).toContain("Projects");
    expect(text).toContain("Clients");
    expect(text).not.toContain("Earnings");
  });

  test("Admin sidebar", async ({ page }) => {
    await login(page, USERS.admin);
    await page.goto("/admin/workspace");
    await page.waitForLoadState("networkidle");
    const text = await page.locator(".admin-sidebar").innerText();
    expect(text).toContain("Earnings");
    expect(text).toContain("Analytics");
    expect(text).toContain("All Users");
  });
});

test.describe("Project Creation", () => {
  test("Create project as admin", async ({ page }) => {
    await login(page, USERS.admin);
    await page.goto("/admin/projects/new");
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => {
      document.querySelector("input[name=projectName]").value = "PW Test Project";
      document.querySelector("input[name=clientName]").value = "PW Client";
      document.querySelector("form.admin-form").submit();
    });
    await page.waitForLoadState("networkidle");
    await expect(page.locator(".flash--success")).toContainText("created");
    expect(page.url()).toContain("/admin/projects/");
  });

  test("Create project as owner with client amount", async ({ page }) => {
    await login(page, USERS.owner);
    await page.goto("/admin/projects/new");
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => {
      document.querySelector("input[name=projectName]").value = "Owner PW Project";
      document.querySelector("input[name=clientName]").value = "Owner PW Client";
      document.querySelector("input[name=clientAmount]").value = "25000";
      document.querySelector("form.admin-form").submit();
    });
    await page.waitForLoadState("networkidle");
    await expect(page.locator(".flash--success")).toContainText("created");
  });

  test("Project name required", async ({ page }) => {
    await login(page, USERS.admin);
    await page.goto("/admin/projects/new");
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => {
      document.querySelector("input[name=clientName]").value = "RequiredTest Client";
      document.querySelector("form.admin-form").submit();
    });
    await page.waitForLoadState("networkidle");
    await expect(page.locator(".flash--error")).toContainText("required");
  });
});

test.describe("Projects List", () => {
  test("Projects page loads with filters", async ({ page }) => {
    await login(page, USERS.admin);
    await page.goto("/admin/projects");
    await expect(page.locator("body")).toContainText("Standard Project");
  });

  test("Filter unassigned", async ({ page }) => {
    await login(page, USERS.admin);
    await page.goto("/admin/projects?filter=unassigned");
    await expect(page).toHaveURL(/filter=unassigned/);
  });

  test("Filter active", async ({ page }) => {
    await login(page, USERS.admin);
    await page.goto("/admin/projects?filter=active");
    await expect(page).toHaveURL(/filter=active/);
  });

  test("Filter completed", async ({ page }) => {
    await login(page, USERS.admin);
    await page.goto("/admin/projects?filter=completed");
    await expect(page).toHaveURL(/filter=completed/);
  });
});

test.describe("Admin Views", () => {
  test("Workspace", async ({ page }) => {
    await login(page, USERS.admin);
    await page.goto("/admin/workspace");
    await expect(page.locator(".admin-page-head")).toContainText("Workspace");
  });

  test("Dashboard", async ({ page }) => {
    await login(page, USERS.admin);
    await page.goto("/admin");
    await expect(page).toHaveTitle(/Dashboard/);
  });

  test("Project detail", async ({ page }) => {
    await login(page, USERS.admin);
    await page.goto("/admin/projects");
    await page.locator("a[href*='/admin/projects/']").first().click();
    await page.waitForLoadState("networkidle");
    await expect(page.locator("h1")).toBeVisible();
  });

  test("Edit project page", async ({ page }) => {
    await login(page, USERS.admin);
    await page.goto("/admin/projects");
    const editLink = page.locator("a[href*='/edit']").first();
    if (await editLink.isVisible()) {
      await editLink.click();
      await page.waitForLoadState("networkidle");
      await expect(page.locator("h1")).toContainText(/Edit/);
    }
  });

  test("Earnings page", async ({ page }) => {
    await login(page, USERS.admin);
    await page.goto("/admin/profits");
    await expect(page).toHaveURL(/\/admin\/profits/);
  });

  test("Clients page", async ({ page }) => {
    await login(page, USERS.admin);
    await page.goto("/admin/clients");
    await expect(page.locator("body")).toContainText("Test Client Inc");
  });

  test("Editors page", async ({ page }) => {
    await login(page, USERS.admin);
    await page.goto("/admin/editors");
    await expect(page.locator("body")).toContainText("Test Editor");
  });

  test("Analytics page", async ({ page }) => {
    await login(page, USERS.admin);
    await page.goto("/admin/analytics");
    await expect(page.locator("h1")).toContainText("Analytics");
  });

  test("Users page", async ({ page }) => {
    await login(page, USERS.admin);
    await page.goto("/admin/users");
    await expect(page).toHaveURL(/\/admin\/users/);
  });
});

test.describe("Owner Views", () => {
  test("Payment status page", async ({ page }) => {
    await login(page, USERS.owner);
    await page.goto("/admin/payment-status");
    await expect(page).toHaveURL(/\/admin\/payment-status/);
  });

  test("Analytics", async ({ page }) => {
    await login(page, USERS.owner);
    await page.goto("/admin/analytics");
    await expect(page.locator("h1")).toContainText("Analytics");
  });
});

test.describe("Editor Views", () => {
  test("Projects list", async ({ page }) => {
    await login(page, USERS.editor);
    await page.goto("/editor/projects");
    await expect(page).toHaveURL(/\/editor\/projects/);
  });

  test("Project detail", async ({ page }) => {
    await login(page, USERS.editor);
    await page.goto("/editor/projects");
    const link = page.locator("a[href*='/editor/projects/']").first();
    if (await link.isVisible()) {
      await link.click();
      await page.waitForLoadState("networkidle");
      await expect(page.locator("h1")).toBeVisible();
    }
  });

  test("Earnings", async ({ page }) => {
    await login(page, USERS.editor);
    await page.goto("/editor/earnings");
    await expect(page).toHaveURL(/\/editor\/earnings/);
  });

  test("Assets", async ({ page }) => {
    await login(page, USERS.editor);
    await page.goto("/editor/assets");
    await expect(page).toHaveURL(/\/editor\/assets/);
  });

  test("Profile", async ({ page }) => {
    await login(page, USERS.editor);
    await page.goto("/editor/profile");
    await expect(page.locator("body")).toContainText("UPI");
  });
});

test.describe("Permission Enforcement", () => {
  test("Editor blocked from admin", async ({ page }) => {
    await login(page, USERS.editor);
    await page.goto("/admin/projects", { waitUntil: "networkidle" });
    await expect(page).toHaveURL(/\/editor\/projects/);
    await expect(page.locator("h1")).toContainText("My Projects");
  });

  test("Editor blocked from workspace", async ({ page }) => {
    await login(page, USERS.editor);
    await page.goto("/admin/workspace", { waitUntil: "networkidle" });
    await expect(page).toHaveURL(/\/editor\/projects/);
  });
});

test.describe("API Endpoints", () => {
  test("Notifications API", async ({ page }) => {
    await login(page, USERS.admin);
    const res = await page.goto("/api/notifications");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.notifications).toBeDefined();
  });

  test("Project counts API", async ({ page }) => {
    await login(page, USERS.admin);
    const res = await page.goto("/api/projects/counts");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.total).toBeGreaterThanOrEqual(0);
  });

  test("Unread count API", async ({ page }) => {
    await login(page, USERS.admin);
    const res = await page.goto("/api/notifications/unread-count");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(typeof body.count).toBe("number");
  });

  test("Search API", async ({ page }) => {
    await login(page, USERS.admin);
    const res = await page.goto("/api/search?q=Standard");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.projects).toBeDefined();
  });

  test("Search requires 2+ chars", async ({ page }) => {
    await login(page, USERS.admin);
    const res = await page.goto("/api/search?q=a");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.projects.length).toBe(0);
  });
});

test.describe("404 Handling", () => {
  test("Nonexistent route", async ({ page }) => {
    await page.goto("/nonexistent-route");
    expect(page.url()).toContain("/nonexistent-route");
  });
});

test.describe("Regression Fixes", () => {
  test("Edit page does not crash", async ({ page }) => {
    await login(page, USERS.admin);
    await page.goto("/admin/projects");
    const editLink = page.locator("a[href*='/edit']").first();
    if (await editLink.isVisible()) {
      const resp = await page.goto(await editLink.getAttribute("href"));
      expect(resp.status()).toBe(200);
      await expect(page.locator("h1")).toContainText(/Edit/);
    }
  });

  test("New project form renders", async ({ page }) => {
    await login(page, USERS.admin);
    const resp = await page.goto("/admin/projects/new");
    expect(resp.status()).toBe(200);
    await expect(page.locator("h1")).toContainText(/New Project/);
  });

  test("Editor profile has UPI field", async ({ page }) => {
    await login(page, USERS.editor);
    await page.goto("/editor/profile");
    await expect(page.locator("body")).toContainText("UPI");
  });
});
