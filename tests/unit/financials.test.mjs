import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFinancialSummary, getClientAmount, getEditorAmount, getProfit } from "../../utils/workflow.js";

function project(overrides) {
  return {
    _id: "p1",
    projectName: "P1",
    status: "completed",
    editorAmount: undefined,
    payment: { editor: { status: "pending" } },
    ...overrides,
  };
}

const SCENARIO = project({
  payment: { editor: { status: "pending" }, clientAmount: 100000, editorAmount: 65000 },
});

test("getClientAmount prefers clientAmount, falls back to legacy payment.amount", () => {
  assert.equal(getClientAmount(SCENARIO), 100000);
  assert.equal(getClientAmount(project({ payment: { amount: 50000 } })), 50000);
  assert.equal(getClientAmount(project({ payment: {} })), 0);
});

test("getEditorAmount prefers top-level editorAmount, falls back to payment.editorAmount", () => {
  assert.equal(getEditorAmount(SCENARIO), 65000);
  assert.equal(getEditorAmount(project({ editorAmount: 7000, payment: { editorAmount: 6000 } })), 7000);
  assert.equal(getEditorAmount(project({ payment: { editorAmount: 6000 } })), 6000);
  assert.equal(getEditorAmount(project({ payment: { clientAmount: 99999 } })), 0);
});

test("getProfit is Client Amount - Editor Amount", () => {
  assert.equal(getProfit(SCENARIO), 35000);
});

test("summary counts completed projects only, regardless of payment status", () => {
  const summary = computeFinancialSummary([
    SCENARIO,
    project({ status: "assigned", payment: { editor: { status: "pending" }, clientAmount: 500, editorAmount: 100 } }),
    project({ payment: { editor: { status: "paid" }, clientAmount: 20000, editorAmount: 8000 } }),
  ]);
  assert.equal(summary.completedCount, 2);
  assert.equal(summary.totalClientAmount, 120000);
  assert.equal(summary.totalEditorAmount, 73000);
  assert.equal(summary.totalProfit, 47000);
  assert.equal(summary.totalPaid, 1);
});

test("pending -> paid transition: earnings invariant, only payment summaries move", () => {
  const before = computeFinancialSummary([SCENARIO]);
  assert.equal(before.pendingPayment, 65000);
  assert.equal(before.paymentMade, 0);
  assert.equal(before.totalPaid, 0);

  const after = computeFinancialSummary([
    project({ payment: { editor: { status: "paid", paidAt: new Date() }, clientAmount: 100000, editorAmount: 65000 } }),
  ]);
  assert.equal(after.totalClientAmount, before.totalClientAmount);
  assert.equal(after.totalEditorAmount, before.totalEditorAmount);
  assert.equal(after.totalProfit, before.totalProfit);
  assert.equal(after.completedCount, before.completedCount);
  assert.equal(after.pendingPayment, 0);
  assert.equal(after.paymentMade, 65000);
  assert.equal(after.totalPaid, 1);
});

test("legacy projects: missing editor payout counts as pending", () => {
  const summary = computeFinancialSummary([
    project({ payment: { clientAmount: 10000, editorAmount: 4000 } }),
  ]);
  assert.equal(summary.pendingPayment, 4000);
  assert.equal(summary.paymentMade, 0);
  assert.equal(summary.totalProfit, 6000);
});
