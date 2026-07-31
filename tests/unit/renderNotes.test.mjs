import { test } from "node:test";
import assert from "node:assert/strict";
import { renderNotes, escapeHtml, linkifyUrls } from "../../utils/renderNotes.js";

const LINK = (url) =>
  `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;

test("renderNotes escapes plain text and creates no links", () => {
  assert.equal(renderNotes("Just some normal text"), "Just some normal text");
  assert.equal(
    renderNotes("Line one\nLine two with <b>html</b>"),
    "Line one\nLine two with &lt;b&gt;html&lt;/b&gt;",
  );
});

test("renderNotes linkifies a single URL and keeps surrounding text plain", () => {
  const out = renderNotes("Reference:\nhttps://example.com");
  assert.equal(out, `Reference:\n${LINK("https://example.com")}`);
  assert.ok(!out.includes(`<a href="Reference:`));
});

test("renderNotes linkifies multiple URLs independently", () => {
  const out = renderNotes(
    "Drive:\nhttps://drive.google.com/a\n\nVideo:\nhttps://youtube.com/b",
  );
  assert.equal(
    out,
    `Drive:\n${LINK("https://drive.google.com/a")}\n\nVideo:\n${LINK("https://youtube.com/b")}`,
  );
});

test("renderNotes preserves paragraphs, blank lines and line breaks", () => {
  const out = renderNotes(
    "Sample -\nhttps://drive.google.com/abc\n\nPlease make it cinematic.",
  );
  assert.equal(
    out,
    `Sample -\n${LINK("https://drive.google.com/abc")}\n\nPlease make it cinematic.`,
  );
  assert.match(out, /\n\n/);
});

test("renderNotes supports common providers", () => {
  const urls = [
    "https://drive.google.com/file/d/1abc",
    "https://www.dropbox.com/s/xyz",
    "https://1drv.ms/u/xyz",
    "https://youtube.com/shorts/xyz",
    "https://www.loom.com/share/xyz",
    "https://app.frame.io/projects/xyz",
    "https://vimeo.com/123456",
    "https://www.notion.so/page-abc",
    "https://www.figma.com/design/xyz",
  ];
  for (const url of urls) {
    assert.equal(renderNotes(url), LINK(url));
  }
});

test("renderNotes trims trailing sentence punctuation from URLs", () => {
  assert.equal(renderNotes("See https://example.com."), `See ${LINK("https://example.com")}.`);
  assert.equal(renderNotes("Go to https://example.com, ok"), `Go to ${LINK("https://example.com")}, ok`);
  assert.equal(renderNotes("URL: https://example.com?"), `URL: ${LINK("https://example.com")}?`);
});

test("renderNotes keeps balanced parentheses inside URLs", () => {
  assert.equal(
    renderNotes("(https://example.com/wiki/Node_(software))"),
    `(${LINK("https://example.com/wiki/Node_(software)")})`,
  );
});

test("renderNotes escapes scripts and never outputs raw HTML", () => {
  const out = renderNotes('<script>alert(1)</script>');
  assert.ok(!out.includes("<script>"));
  assert.ok(out.includes("&lt;script&gt;"));
});

test("renderNotes escapes img onerror payload", () => {
  const out = renderNotes('<img src=x onerror=alert(1)>');
  assert.ok(!out.includes("<img"));
  assert.ok(out.includes("&lt;img src=x onerror=alert(1)&gt;"));
});

test("renderNotes does not linkify javascript: URLs", () => {
  const out = renderNotes('javascript:alert(1)');
  assert.equal(out, "javascript:alert(1)");
});

test("renderNotes escapes URL hrefs", () => {
  const out = renderNotes('https://example.com/path?q=1&x=2');
  assert.ok(out.includes('href="https://example.com/path?q=1&amp;x=2"'));
});

test("renderNotes handles empty and null input", () => {
  assert.equal(renderNotes(""), "");
  assert.equal(renderNotes(null), "");
  assert.equal(renderNotes(undefined), "");
});

test("escapeHtml escapes all HTML metacharacters", () => {
  assert.equal(escapeHtml(`&<>"'`), "&amp;&lt;&gt;&quot;&#39;");
});

test("linkifyUrls is exported and safe", () => {
  assert.equal(linkifyUrls("x https://a.com y"), `x ${LINK("https://a.com")} y`);
});
