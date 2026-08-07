# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: workflow.spec.mjs >> Project Drive Links >> Editor can view both links (read-only)
- Location: tests/workflow.spec.mjs:315:3

# Error details

```
Test timeout of 60000ms exceeded.
```

```
Error: locator.click: Test timeout of 60000ms exceeded.
Call log:
  - waiting for locator('.project-card').filter({ hasText: 'Direct Assign Project' }).first().locator('a').first()
    - locator resolved to <a href="/editor/projects/6a758afb2ea442c68f257bde">Direct Assign Project</a>
  - attempting click action
    2 × waiting for element to be visible, enabled and stable
      - element is not visible
    - retrying click action
    - waiting 20ms
    2 × waiting for element to be visible, enabled and stable
      - element is not visible
    - retrying click action
      - waiting 100ms
    118 × waiting for element to be visible, enabled and stable
        - element is not visible
      - retrying click action
        - waiting 500ms

```

# Page snapshot

```yaml
- generic [ref=e2]:
  - banner [ref=e3]:
    - generic [ref=e4]:
      - link "Panther Corporation Panther Corporation" [ref=e6] [cursor=pointer]:
        - /url: /
        - img "Panther Corporation" [ref=e7]
        - text: Panther Corporation
      - navigation "Main" [ref=e8]:
        - navigation "Editor" [ref=e9]:
          - link "My Projects" [ref=e10] [cursor=pointer]:
            - /url: /editor/projects
          - link "Ongoing" [ref=e11] [cursor=pointer]:
            - /url: /editor/projects?tab=ongoing
          - link "Completed" [ref=e12] [cursor=pointer]:
            - /url: /editor/projects?tab=completed
          - link "My Assets" [ref=e13] [cursor=pointer]:
            - /url: /editor/assets
          - link "Profile" [ref=e14] [cursor=pointer]:
            - /url: /editor/profile
          - link "Earnings" [ref=e15] [cursor=pointer]:
            - /url: /editor/earnings
        - button "Notifications" [ref=e16] [cursor=pointer]:
          - img [ref=e17]
        - generic [ref=e20]: Test Editor
        - button "Logout" [ref=e22] [cursor=pointer]
  - main [ref=e23]:
    - generic [ref=e24]:
      - generic [ref=e25]:
        - paragraph [ref=e26]: My workspace
        - heading "My Projects" [level=1] [ref=e27]
      - link "My Assets" [ref=e28] [cursor=pointer]:
        - /url: /editor/assets
    - tablist "Project tabs" [ref=e29]:
      - tab "My Projects 0" [selected] [ref=e30] [cursor=pointer]:
        - text: My Projects
        - generic [ref=e31]: "0"
      - tab "Ongoing 4" [ref=e32] [cursor=pointer]:
        - text: Ongoing
        - generic [ref=e33]: "4"
      - tab "Completed 2" [ref=e34] [cursor=pointer]:
        - text: Completed
        - generic [ref=e35]: "2"
    - tabpanel "My Projects" [ref=e36]:
      - paragraph [ref=e38]: No new projects assigned to you.
  - contentinfo [ref=e39]:
    - paragraph [ref=e41]: © 2026 Panther Corporation. All rights reserved.
```

# Test source

```ts
  219 |     await expect(page.locator("tbody")).toContainText("Direct Assign Project");
  220 |     await expect(page.locator("tbody")).toContainText("Paid Project");
  221 |     await expect(page.locator("tbody")).not.toContainText("Standard Project");
  222 |   });
  223 | 
  224 |   test("Filter projects by Short type", async ({ page }) => {
  225 |     await login(page, USERS.admin);
  226 |     await page.goto("/admin/projects?type=Short");
  227 |     await page.waitForLoadState("networkidle");
  228 |     await expect(page.locator("tbody")).toContainText("Standard Project");
  229 |     await expect(page.locator("tbody")).not.toContainText("Direct Assign Project");
  230 |   });
  231 | 
  232 |   test("Legacy project without type displays as Short", async ({ page }) => {
  233 |     await login(page, USERS.admin);
  234 |     await page.goto("/admin/projects");
  235 |     await page.waitForLoadState("networkidle");
  236 |     const row = page.locator("tbody tr", { hasText: "Ongoing Project" });
  237 |     await expect(row.locator(".tag", { hasText: "Short" })).toBeVisible();
  238 |   });
  239 | 
  240 |   test("Editor can view project type (read-only)", async ({ page }) => {
  241 |     await login(page, USERS.editor);
  242 |     await page.goto("/editor/projects");
  243 |     await page.waitForLoadState("networkidle");
  244 |     const card = page.locator(".project-card", { hasText: "Direct Assign Project" }).first();
  245 |     await expect(card).toContainText("Long");
  246 |   });
  247 | });
  248 | 
  249 | test.describe("Project Drive Links", () => {
  250 |   test("Create form shows both link fields; projectFilesLink required on create", async ({ page }) => {
  251 |     await login(page, USERS.admin);
  252 |     await page.goto("/admin/projects/new");
  253 |     await page.waitForLoadState("networkidle");
  254 |     await expect(page.locator("#assetsFolderLink")).toBeVisible();
  255 |     await expect(page.locator("#projectFilesLink")).toBeVisible();
  256 |     await expect(page.locator("#assetsFolderLink")).not.toHaveAttribute("required");
  257 |     await expect(page.locator("#projectFilesLink")).toHaveAttribute("required", "");
  258 |   });
  259 | 
  260 |   test("Project Files Link is required at creation", async ({ page }) => {
  261 |     await login(page, USERS.admin);
  262 |     await page.goto("/admin/projects/new");
  263 |     await page.waitForLoadState("networkidle");
  264 |     await page.evaluate(() => {
  265 |       document.querySelector("input[name=projectName]").value = "PW Missing Files Link";
  266 |       document.querySelector("input[name=clientName]").value = "PW Missing Files Client";
  267 |       document.querySelector("form.admin-form").submit();
  268 |     });
  269 |     await page.waitForLoadState("networkidle");
  270 |     await expect(page.locator(".flash--error")).toContainText("Project Files Link is required.");
  271 |   });
  272 | 
  273 |   test("Create project with both links and persist to detail page", async ({ page }) => {
  274 |     await login(page, USERS.admin);
  275 |     await page.goto("/admin/projects/new");
  276 |     await page.waitForLoadState("networkidle");
  277 |     await page.evaluate(() => {
  278 |       document.querySelector("input[name=projectName]").value = "PW Links Project";
  279 |       document.querySelector("input[name=clientName]").value = "PW Links Client";
  280 |       document.querySelector("input[name=assetsFolderLink]").value = "https://drive.google.com/pw-assets";
  281 |       document.querySelector("input[name=projectFilesLink]").value = "https://drive.google.com/pw-project-files";
  282 |       document.querySelector("form.admin-form").submit();
  283 |     });
  284 |     await page.waitForLoadState("networkidle");
  285 |     await expect(page.locator(".flash--success")).toContainText("created");
  286 |     expect(page.url()).toContain("/admin/projects/");
  287 |     const row = page.locator(".admin-detail-grid");
  288 |     await expect(row).toContainText("Assets Folder Link");
  289 |     await expect(row).toContainText("https://drive.google.com/pw-assets");
  290 |     await expect(row).toContainText("Project Files Link");
  291 |     await expect(row).toContainText("https://drive.google.com/pw-project-files");
  292 |     await expect(row).not.toContainText("Not provided");
  293 |   });
  294 | 
  295 |   test("Edit form shows and updates both links", async ({ page }) => {
  296 |     await login(page, USERS.admin);
  297 |     await page.goto("/admin/projects");
  298 |     await page.waitForLoadState("networkidle");
  299 |     await page.locator("tbody tr", { hasText: "Standard Project" }).locator("a.admin-link").click();
  300 |     await page.waitForLoadState("networkidle");
  301 |     await page.locator('a[href$="/edit"]').click();
  302 |     await page.waitForLoadState("networkidle");
  303 |     await expect(page.locator("#assetsFolderLink")).toHaveValue("https://drive.google.com/standard");
  304 |     await expect(page.locator("#projectFilesLink")).toHaveValue("https://drive.google.com/standard-files");
  305 |     await page.fill("#assetsFolderLink", "https://drive.google.com/standard-assets-v2");
  306 |     await page.fill("#projectFilesLink", "https://drive.google.com/standard-files-v2");
  307 |     await page.click("form.admin-form button[type=submit]");
  308 |     await page.waitForLoadState("networkidle");
  309 |     await expect(page.locator(".flash--success")).toContainText("updated");
  310 |     const row = page.locator(".admin-detail-grid");
  311 |     await expect(row).toContainText("https://drive.google.com/standard-assets-v2");
  312 |     await expect(row).toContainText("https://drive.google.com/standard-files-v2");
  313 |   });
  314 | 
  315 |   test("Editor can view both links (read-only)", async ({ page }) => {
  316 |     await login(page, USERS.editor);
  317 |     await page.goto("/editor/projects");
  318 |     await page.waitForLoadState("networkidle");
> 319 |     await page.locator(".project-card", { hasText: "Direct Assign Project" }).first().locator("a").first().click();
      |                                                                                                            ^ Error: locator.click: Test timeout of 60000ms exceeded.
  320 |     await page.waitForLoadState("networkidle");
  321 |     await expect(page.locator("body")).toContainText("Assets Folder Link");
  322 |     await expect(page.locator("body")).toContainText("https://drive.google.com/direct");
  323 |     await expect(page.locator("body")).toContainText("Project Files Link");
  324 |     await expect(page.locator("body")).toContainText("https://drive.google.com/direct-files");
  325 |   });
  326 | });
  327 | 
  328 | test.describe("Admin Views", () => {
  329 |   test("Workspace", async ({ page }) => {
  330 |     await login(page, USERS.admin);
  331 |     await page.goto("/admin/workspace");
  332 |     await expect(page.locator(".admin-page-head")).toContainText("Workspace");
  333 |   });
  334 | 
  335 |   test("Workspace chips filter by Project Type", async ({ page }) => {
  336 |     await login(page, USERS.admin);
  337 |     await page.goto("/admin/workspace");
  338 |     await page.waitForLoadState("networkidle");
  339 |     const row = page.locator('.type-chips-row[data-chips-for="my"]');
  340 |     await expect(row).toContainText("Project Type");
  341 | 
  342 |     const chips = row.locator(".type-chip");
  343 |     await expect(chips).toHaveCount(3);
  344 |     await expect(chips.nth(0)).toContainText("All");
  345 |     await expect(chips.nth(1)).toContainText("Short");
  346 |     await expect(chips.nth(2)).toContainText("Long");
  347 |     await expect(row).not.toContainText("Shorts");
  348 |     await expect(row).not.toContainText("Timeline");
  349 | 
  350 |     const allChipText = await chips.nth(0).innerText();
  351 |     const allCount = parseInt(allChipText.match(/\d+/)[0], 10);
  352 |     const totalCards = await page.locator('[data-tab-panel="my"] .project-card').count();
  353 |     expect(allCount).toBe(totalCards);
  354 | 
  355 |     await chips.nth(2).click();
  356 |     await expect(page.locator('[data-tab-panel="my"] .project-card[data-type="Short"]').first()).toBeHidden();
  357 |     await expect(page.locator('[data-tab-panel="my"] .project-card[data-type="Long"]').first()).toBeVisible();
  358 |   });
  359 | 
  360 |   test("Dashboard", async ({ page }) => {
  361 |     await login(page, USERS.admin);
  362 |     await page.goto("/admin");
  363 |     await expect(page).toHaveTitle(/Dashboard/);
  364 |   });
  365 | 
  366 |   test("Project detail", async ({ page }) => {
  367 |     await login(page, USERS.admin);
  368 |     await page.goto("/admin/projects");
  369 |     await page.locator("a[href*='/admin/projects/']").first().click();
  370 |     await page.waitForLoadState("networkidle");
  371 |     await expect(page.locator("h1")).toBeVisible();
  372 |   });
  373 | 
  374 |   test("Edit project page", async ({ page }) => {
  375 |     await login(page, USERS.admin);
  376 |     await page.goto("/admin/projects");
  377 |     const editLink = page.locator("a[href*='/edit']").first();
  378 |     if (await editLink.isVisible()) {
  379 |       await editLink.click();
  380 |       await page.waitForLoadState("networkidle");
  381 |       await expect(page.locator("h1")).toContainText(/Edit/);
  382 |     }
  383 |   });
  384 | 
  385 |   test("Earnings page", async ({ page }) => {
  386 |     await login(page, USERS.admin);
  387 |     await page.goto("/admin/profits");
  388 |     await expect(page).toHaveURL(/\/admin\/profits/);
  389 |   });
  390 | 
  391 |   test("Clients page", async ({ page }) => {
  392 |     await login(page, USERS.admin);
  393 |     await page.goto("/admin/clients");
  394 |     await expect(page.locator("body")).toContainText("Test Client Inc");
  395 |   });
  396 | 
  397 |   test("Editors page", async ({ page }) => {
  398 |     await login(page, USERS.admin);
  399 |     await page.goto("/admin/editors");
  400 |     await expect(page.locator("body")).toContainText("Test Editor");
  401 |   });
  402 | 
  403 |   test("Analytics page", async ({ page }) => {
  404 |     await login(page, USERS.admin);
  405 |     await page.goto("/admin/analytics");
  406 |     await expect(page.locator("h1")).toContainText("Analytics");
  407 |   });
  408 | 
  409 |   test("Users page", async ({ page }) => {
  410 |     await login(page, USERS.admin);
  411 |     await page.goto("/admin/users");
  412 |     await expect(page).toHaveURL(/\/admin\/users/);
  413 |   });
  414 | });
  415 | 
  416 | test.describe("Owner Views", () => {
  417 |   test("Payment status page", async ({ page }) => {
  418 |     await login(page, USERS.owner);
  419 |     await page.goto("/admin/payment-status");
```