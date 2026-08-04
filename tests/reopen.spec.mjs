import { test, expect } from "@playwright/test";

const USERS = {
  owner: { email: "owner@test.com", password: "password123" },
  admin: { email: "admin@test.com", password: "password123" },
  editor: { email: "editor@test.com", password: "password123" },
};

async function login(page, user) {
  await page.goto("/login");
  await page.waitForSelector("input[name=email]", { timeout: 5000 });
  await page.fill("input[name=email]", user.email);
  await page.fill("input[name=password]", user.password);
  await page.click("button.btn--full");
  await page.waitForLoadState("networkidle");
}

async function apiJson(page, url, opts) {
  return page.evaluate(async ({ url, opts }) => {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: opts?.body || JSON.stringify({}) });
    return { ok: r.ok, status: r.status, body: await r.json().catch(() => null) };
  }, { url, opts });
}

test.describe("Reopen Completed Project", () => {
  test("Full lifecycle: owner direct-assign → complete → reopen → ongoing on owner/admin/editor", async ({ page }) => {
    // Resolve the Direct Assign Project id (owner-created, assigned directly to editor)
    await login(page, USERS.owner);
    const id = await page.evaluate(async () => {
      const r = await fetch("/api/search?q=Direct%20Assign");
      const d = await r.json();
      return d.projects[0]._id;
    });
    expect(id).toBeTruthy();

    // Editor accepts (assigned → ongoing)
    await login(page, USERS.editor);
    let res = await apiJson(page, `/editor/projects/${id}/accept`);
    expect(res.status).toBe(200);

    // Editor submits version 1 (ongoing → submitted)
    res = await apiJson(page, `/editor/projects/${id}/submit`, { body: JSON.stringify({ driveLink: "https://drive.google.com/reopen-v1", description: "v1" }) });
    expect(res.status).toBe(200);

    // Admin completes (submitted → completed)
    await login(page, USERS.admin);
    res = await apiJson(page, `/admin/projects/${id}/complete`);
    expect(res.status).toBe(200);
    let status = await page.evaluate(async () => {
      const r = await fetch("/api/search?q=Direct%20Assign");
      const d = await r.json();
      return d.projects[0].status;
    });
    expect(status).toBe("completed");

    // Admin sees Reopen button on the completed listing
    await page.goto("/admin/projects?filter=completed");
    await page.waitForLoadState("networkidle");
    const row = page.locator("tbody tr", { hasText: "Direct Assign Project" });
    await expect(row).toBeVisible();
    const reopenBtn = row.locator("button", { hasText: "Reopen Project" });
    await expect(reopenBtn).toBeVisible();

    // Click Reopen
    await reopenBtn.click();
    await page.waitForLoadState("networkidle");

    // Admin listing: in Active, gone from Completed
    await page.goto("/admin/projects?filter=active");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("tbody tr", { hasText: "Direct Assign Project" })).toBeVisible();
    await page.goto("/admin/projects?filter=completed");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("tbody")).not.toContainText("Direct Assign Project");

    // Owner workspace: project visible in Ongoing tab
    await login(page, USERS.owner);
    await page.goto("/admin/workspace?tab=ongoing");
    await page.waitForLoadState("networkidle");
    await expect(page.locator(".project-card", { hasText: "Direct Assign Project" }).first()).toBeVisible();

    // Editor portal: project in Ongoing tab, not Completed
    await login(page, USERS.editor);
    await page.goto("/editor/projects?tab=ongoing");
    await page.waitForLoadState("networkidle");
    await expect(page.locator(".project-card", { hasText: "Direct Assign Project" }).first()).toBeVisible();
    await page.goto("/editor/projects?tab=completed");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("#tab-panel-completed .project-card", { hasText: "Direct Assign Project" })).toHaveCount(0);
  });
});