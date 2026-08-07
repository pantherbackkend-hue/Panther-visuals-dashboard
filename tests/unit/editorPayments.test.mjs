import { test } from "node:test";
import assert from "node:assert/strict";
import { computeEditorPayments } from "../../utils/workflow.js";

const editors = [
  { _id: "e1", name: "Hemanga Mallick", upiId: "hemanga@okhdfc", availability: "available", isActive: true },
  { _id: "e2", name: "Other Editor", upiId: "", availability: "available", isActive: true },
];

function project(id, editorId, amount, status, paidAt) {
  return {
    _id: id,
    projectName: `P${id}`,
    assignedEditor: editorId,
    editorAmount: amount,
    payment: { editor: { status, paidAt: paidAt || null } },
  };
}

test("sums editorAmount of pending completed projects only, never clientAmount", () => {
  const rows = computeEditorPayments(editors, [
    project("p1", "e1", 3000, "pending"),
    project("p2", "e1", 500, "pending"),
    project("p3", "e1", 8000, "paid", new Date("2026-08-05T10:00:00Z")),
  ]);
  const row = rows[0];
  assert.equal(row.completedCount, 3);
  assert.equal(row.pendingCount, 2);
  assert.equal(row.pendingAmount, 3500);
  assert.equal(row.pendingProjects.length, 2);
  assert.deepEqual(row.pendingProjects.map((p) => p.editorAmount), [3000, 500]);
  assert.equal(row.lastPaidAt.toISOString(), new Date("2026-08-05T10:00:00Z").toISOString());
});

test("editors with no projects report zeroes; projects of other editors are ignored", () => {
  const rows = computeEditorPayments(editors, [project("p1", "e2", 900, "pending")]);
  assert.equal(rows[0].pendingAmount, 0);
  assert.equal(rows[0].completedCount, 0);
  assert.equal(rows[1].pendingAmount, 900);
  assert.equal(rows[1].lastPaidAt, null);
});

test("projects without editorAmount count as zero due, not client amount", () => {
  const legacy = {
    _id: "p1",
    projectName: "Legacy",
    assignedEditor: "e1",
    editorAmount: undefined,
    payment: { clientAmount: 99999 },
  };
  const rows = computeEditorPayments(editors, [legacy]);
  assert.equal(rows[0].pendingAmount, 0);
  assert.equal(rows[0].pendingCount, 1);
});

test("admin payout status does not affect editor payment module", () => {
  const rows = computeEditorPayments(editors, [
    project("p1", "e1", 3000, "pending"),
    { ...project("p2", "e1", 5000, "pending"), payment: { admin: { status: "paid" }, editor: { status: "pending" } } },
  ]);
  const row = rows[0];
  assert.equal(row.pendingCount, 2);
  assert.equal(row.pendingAmount, 8000);
  assert.equal(row.lastPaidAt, null);
});
