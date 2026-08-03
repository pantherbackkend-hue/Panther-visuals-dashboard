import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeProjectType } from "../../utils/admin.js";

test("normalizeProjectType keeps valid values", () => {
  assert.equal(normalizeProjectType("Short"), "Short");
  assert.equal(normalizeProjectType("Long"), "Long");
});

test("normalizeProjectType handles surrounding whitespace", () => {
  assert.equal(normalizeProjectType("  Long  "), "Long");
  assert.equal(normalizeProjectType(" Short "), "Short");
});

test("normalizeProjectType defaults invalid values to Short", () => {
  assert.equal(normalizeProjectType("medium"), "Short");
  assert.equal(normalizeProjectType("short"), "Short");
  assert.equal(normalizeProjectType("LONG"), "Short");
  assert.equal(normalizeProjectType("bogus"), "Short");
});

test("normalizeProjectType defaults missing/empty values to Short", () => {
  assert.equal(normalizeProjectType(""), "Short");
  assert.equal(normalizeProjectType(null), "Short");
  assert.equal(normalizeProjectType(undefined), "Short");
  assert.equal(normalizeProjectType(123), "Short");
});
