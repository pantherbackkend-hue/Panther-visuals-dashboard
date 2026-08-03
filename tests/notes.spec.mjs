import { test, expect } from "@playwright/test";

const USERS = {
  admin: { email: "admin@test.com", password: "password123" },
};

async function login(page) {
  await page.goto("/login");
  await page.waitForSelector("input[name=email]", { timeout: 5000 });
  await page.fill("input[name=email]", USERS.admin.email);
  await page.fill("input[name=password]", USERS.admin.password);
  await page.click("button.btn--full");
  await page.waitForLoadState("networkidle");
}

async function createProject(page, { projectName, clientName, clientNotes, notes, assignEditor = false }) {
  await login(page);
  await page.goto("/admin/projects/new");
  await page.waitForLoadState("networkidle");
  await page.check('input[name="clientMode"][value="new"]');
  await page.fill("#clientName", clientName);
  await page.fill("#projectName", projectName);
  await page.fill("#projectFilesLink", "https://drive.google.com/notes-files");
  if (clientNotes !== undefined) await page.fill("#clientNotes", clientNotes);
  if (notes !== undefined) await page.fill("#notes", notes);
  if (assignEditor) {
    const editorValue = await page
      .locator("#assignedEditor option", { hasText: "Test Editor" })
      .first()
      .getAttribute("value");
    await page.selectOption("#assignedEditor", editorValue);
  }
  await page.click("form.admin-form button[type=submit]");
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".flash--success")).toContainText("created");
  expect(page.url()).toMatch(/\/admin\/projects\/[a-f0-9]+/);
}

const notesBlock = (page) => page.locator("strong[style*='pre-wrap']");
const notesLinks = (page) => notesBlock(page).locator("a");

async function openClientDetail(page, clientName) {
  await page.goto("/admin/clients");
  await page.waitForLoadState("networkidle");
  await page.locator("a.admin-link", { hasText: clientName }).click();
  await page.waitForLoadState("networkidle");
}

test.describe("Notes: Normal Text", () => {
  test("plain text renders normally with no hyperlinks", async ({ page }) => {
    const notes = "Just some plain narrative text.\nNothing to click here.";
    await createProject(page, {
      projectName: "NT Plain Notes Project",
      clientName: "NT Plain Notes Client",
      notes,
    });

    const block = notesBlock(page);
    await expect(block).toContainText("Just some plain narrative text.");
    await expect(block).toContainText("Nothing to click here.");
    await expect(block.locator("a")).toHaveCount(0);
  });
});

test.describe("Notes: Single URL", () => {
  test("URL is clickable, opens in a new tab, surrounding text not in anchor", async ({ page }) => {
    const url = "https://example.com";
    await createProject(page, {
      projectName: "NT Single URL Project",
      clientName: "NT Single URL Client",
      notes: `Reference:\n${url}`,
    });

    const block = notesBlock(page);
    await expect(block).toContainText("Reference:");

    const link = notesLinks(page);
    await expect(link).toHaveCount(1);
    await expect(link).toHaveText(url);
    await expect(link).toHaveAttribute("href", url);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");

    const [popup] = await Promise.all([
      page.waitForEvent("popup"),
      link.click(),
    ]);
    await popup.close();
  });
});

test.describe("Notes: Multiple URLs", () => {
  test("multiple links render independently", async ({ page }) => {
    await createProject(page, {
      projectName: "NT Multi URL Project",
      clientName: "NT Multi URL Client",
      notes:
        "Drive:\nhttps://drive.google.com/file/d/1abc\n\nVideo:\nhttps://youtube.com/shorts/xyz",
    });

    const block = notesBlock(page);
    await expect(block).toContainText("Drive:");
    await expect(block).toContainText("Video:");

    const links = notesLinks(page);
    await expect(links).toHaveCount(2);

    const drive = links.filter({ hasText: "https://drive.google.com" });
    const video = links.filter({ hasText: "https://youtube.com" });

    await expect(drive).toHaveAttribute("href", "https://drive.google.com/file/d/1abc");
    await expect(drive).toHaveAttribute("target", "_blank");
    await expect(video).toHaveAttribute("href", "https://youtube.com/shorts/xyz");
    await expect(video).toHaveAttribute("target", "_blank");
    await expect(video).toHaveAttribute("rel", "noopener noreferrer");
  });
});

test.describe("Notes: Mixed Content", () => {
  test("normal text, clickable URL and normal paragraph all render", async ({ page }) => {
    const url = "https://drive.google.com/file/d/1abc";
    await createProject(page, {
      projectName: "NT Mixed Project",
      clientName: "NT Mixed Client",
      notes: `Sample -\n${url}\n\nPlease make it cinematic.`,
    });

    const block = notesBlock(page);
    await expect(block).toContainText("Sample -");
    await expect(block).toContainText("Please make it cinematic.");

    const link = notesLinks(page);
    await expect(link).toHaveCount(1);
    await expect(link).toHaveText(url);
    await expect(link).toHaveAttribute("href", url);
  });
});

test.describe("Notes: Preserve Formatting", () => {
  test("blank lines, paragraphs and line breaks are preserved", async ({ page }) => {
    const notes =
      "First paragraph line one.\nFirst paragraph line two.\n\nSecond paragraph.\n\n\nThird paragraph after two blank lines.";
    await createProject(page, {
      projectName: "NT Format Project",
      clientName: "NT Format Client",
      notes,
    });

    const text = await notesBlock(page).innerText();
    expect(text).toContain("First paragraph line one.\nFirst paragraph line two.");
    expect(text).toContain("\n\nSecond paragraph.");
    expect(text).toContain("\n\n\nThird paragraph after two blank lines.");
    expect(text.split("\n\n").length).toBeGreaterThanOrEqual(3);
  });
});

test.describe("Notes: Security", () => {
  test("script tag is escaped and nothing executes", async ({ page }) => {
    let dialogSeen = false;
    page.on("dialog", () => {
      dialogSeen = true;
    });

    const malicious = "<script>alert(1)</script>";
    await createProject(page, {
      projectName: "NT XSS Script Project",
      clientName: "NT XSS Script Client",
      notes: malicious,
    });

    await expect(page.locator("h1")).toBeVisible();
    expect(dialogSeen).toBe(false);
    const block = notesBlock(page);
    await expect(block).toContainText("<script>alert(1)</script>");
    await expect(block.locator("script")).toHaveCount(0);

    await page.goto(page.url() + "/edit");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("#notes")).toHaveValue(malicious);
  });

  test("img onerror payload is escaped and does not execute", async ({ page }) => {
    let dialogSeen = false;
    page.on("dialog", () => {
      dialogSeen = true;
    });

    const malicious = '<img src=x onerror=alert(1)>';
    await createProject(page, {
      projectName: "NT XSS Img Project",
      clientName: "NT XSS Img Client",
      notes: malicious,
    });

    await expect(page.locator("h1")).toBeVisible();
    expect(dialogSeen).toBe(false);
    const block = notesBlock(page);
    await expect(block).toContainText("<img src=x onerror=alert(1)>");
    await expect(block.locator("img")).toHaveCount(0);
  });
});

test.describe("Notes: Client Notes", () => {
  test("client notes render linkified on client detail page and stay plain in storage", async ({ page }) => {
    const url = "https://www.figma.com/design/abc";
    await createProject(page, {
      projectName: "NT Client Notes Project",
      clientName: "NT Client Notes Client",
      clientNotes: `Brand kit:\n${url}`,
    });

    await openClientDetail(page, "NT Client Notes Client");

    const block = notesBlock(page).last();
    await expect(block).toContainText("Brand kit:");
    const link = block.locator("a");
    await expect(link).toHaveCount(1);
    await expect(link).toHaveText(url);
    await expect(link).toHaveAttribute("href", url);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");

    await page.goto("/admin/clients");
    await page.waitForLoadState("networkidle");
    const row = page.locator("tbody tr", { hasText: "NT Client Notes Client" });
    await expect(row).toHaveCount(1);
    const tableLink = row.locator("a[target=_blank]");
    await expect(tableLink).toHaveCount(1);
    await expect(tableLink).toHaveAttribute("href", url);
  });
});

test.describe("Notes: Timeline Notes", () => {
  test("activity timeline notes render linkified", async ({ page }) => {
    await createProject(page, {
      projectName: "NT Timeline Notes Project",
      clientName: "NT Timeline Notes Client",
      notes: "https://notion.so/page-1",
      assignEditor: true,
    });

    const timeline = page.locator("#timeline");
    await expect(timeline).toContainText("Project Created");

    const statusForm = page.locator("form[action$='/transition']").first();
    await expect(statusForm).toBeVisible();
    await statusForm.locator("[name=toStatus]").selectOption({ label: "Ongoing" });
    await statusForm.locator("[name=notes]").fill("See https://example.com");
    await statusForm.locator("button[type=submit]").click();
    await page.waitForLoadState("networkidle");
    await expect(page.locator(".flash--success")).toContainText("moved");

    const updatedLinks = page.locator("#timeline .timeline-notes a[target=_blank]");
    await expect(updatedLinks.first()).toHaveAttribute("href", "https://example.com");
    await expect(updatedLinks.first()).toHaveAttribute("rel", "noopener noreferrer");
    await expect(updatedLinks.first()).toHaveText("https://example.com");
  });
});
