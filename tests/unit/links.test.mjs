import test from "node:test";
import assert from "node:assert/strict";

import { validateUrl } from "../../utils/links.js";

test("validateUrl accepts any http(s) link", () => {
  const links = [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ",
    "https://vimeo.com/123456789",
    "https://drive.google.com/drive/folders/abc123",
    "https://docs.google.com/document/d/xyz/edit",
    "https://sheets.google.com/",
    "https://loom.com/share/abc",
    "https://dropbox.com/s/xyz/file.pdf",
    "https://res.cloudinary.com/demo/video/upload/v1/video.mp4",
    "https://www.notion.so/Some-Page-1234",
    "http://internal.company.local/wiki/onboarding",
  ];
  for (const link of links) {
    assert.equal(validateUrl(link), "", `expected ${link} to be valid`);
  }
});

test("validateUrl rejects empty, malformed, and non-http(s) values", () => {
  assert.match(validateUrl(""), /required/);
  assert.match(validateUrl("   "), /required/);
  assert.match(validateUrl("not a url"), /valid URL/);
  assert.match(validateUrl("https://"), /valid URL/);
  assert.match(validateUrl("javascript:alert(1)"), /http\(s\)/);
  assert.match(validateUrl("ftp://files.example.com/a"), /http\(s\)/);
});