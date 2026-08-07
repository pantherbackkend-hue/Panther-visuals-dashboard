# Panther Visuals Dashboard — QA Test Report

**Report date:** 2026-08-07 12:54 IST
**Release candidate:** commit `484713c` (admin earnings page fixed)
**Branch:** `main`
**QA scope:** Full end-to-end regression — workflows, permissions, payments (dual Admin/Editor payouts, Owner-only Mark Paid to Admin), notifications, timeline, earnings, ledger, search/filter, financial & DB integrity, performance.

---

## 1. Executive Summary

| Verdict | |
|---|---|
| **Overall** | **PASS — RELEASE RECOMMENDED** |
| Total checks | **223** (108 E2E + 28 unit + 79 Playwright + 8 screenshot renders) |
| Passed | **222** |
| Failed | **1** (pre-existing test-ordering flake, root cause identified, **not** caused by this release) |
| New bugs found | **1** (client login infinite-redirect loop — pre-existing, outside this release's changes, recommended fix included) |

All release-scope features verified end-to-end against a fresh database: the complete project lifecycle (create → assign → accept → submit → feedback → re-submit → complete), dual payment tracking (`payment.admin` / `payment.editor`), the Owner-only "Mark Paid to Admin" permission gate, editor payment module, earnings, ledger, reopen cycle, versioning, notifications, role-based access control, search/filter, financial integrity, and DB integrity. No regressions introduced by this release.

---

## 2. Environment

| Item | Value |
|---|---|
| App | Panther Visuals Dashboard (Node.js / Express 5 / Mongoose 8 / EJS / Socket.io) |
| Node.js | v22.23.1 |
| npm | 10.9.8 |
| Playwright | 1.60.0 (chromium, workers=1, fullyParallel=false) |
| Database | MongoMemoryServer (isolated test DB, seeded per run — production data untouched) |
| Server | `node server.js`, PORT=7900–7901, `MONGODB_URI` overridden |
| Test users | QA Owner / QA Admin / QA Editor One (Shorts) / QA Editor Two (Long Form) / QA Client / QA Signup Client — all created per-run, password `qapass123` |
| Test projects | `TEST - Long Project 01/02`, `TEST - Short Project 01/02`, `TEST - Screenshot Project`, `TEST - Perf Project` — all `TEST -` prefixed, none touch production/demo data |
| Date/time | 2026-08-07 12:54 IST |
| Browser | Chromium headless, 1440×900 |

---

## 3. Test Matrix

### 3.1 Scenario S1 — Long project / new client / JR-Admin lifecycle
*Owner creates Long project via JR Admin; admin assigns; editor accepts, submits V1; owner requests revision; editor submits V2; owner completes; owner marks both payouts paid.*

| # | Check | Result |
|---|---|---|
| S1.1 | Owner login | PASS |
| S1.2 | Admin login | PASS |
| S1.3 | Editor login | PASS |
| S1.4 | Owner creates Long project via JR Admin (redirects to detail page) | PASS |
| S1.5 | Status `pending_assignment`, type `Long`, `ownerAssignment=admin`, `ownerAdmin` set | PASS |
| S1.6 | Client amount 12000 recorded; editor amount 0 until set | PASS |
| S1.7 | `receivedDate` persisted | PASS |
| S1.8 | New client auto-created and linked | PASS |
| S1.9 | Timeline `[0]` = "Project Created" | PASS |
| S1.10 | Admin assigns editor → status `assigned`, editor availability updated | PASS |
| S1.11 | Editor accepts → `ongoing` | PASS |
| S1.12 | Editor submits V1 → `submitted`, 1 submission | PASS |
| S1.13 | Owner feedback → back to `ongoing`, feedback recorded | PASS |
| S1.14 | Editor uploads V2 → version 2, latest drive link = s1-v2 | PASS |
| S1.15 | Owner completes → `completed` + `completedAt` | PASS |
| S1.16 | Owner marks Admin Paid → `payment.admin.status=paid` + `paidAt` + `paidBy=owner` | PASS |
| S1.17 | Owner marks Editor Paid → `payment.editor.status=paid` + `paidAt` + `paidBy=owner` | PASS |
| S1.18 | Financials unchanged by payments (client 12000 / editor 0) | PASS |
| S1.19 | Timeline exact sequence: `Project Created` ×2, `Assigned`, `Accepted`, `Submission Uploaded`, `Feedback Added`, `Submission Uploaded`, `Completed`, `Payment made to Admin`, `Payment made to Editor` | PASS |
| S1.20 | Notifications: submitted + completed + payment_done all exist | PASS |
| S1.21 | Editor receives `payment_done` notification; admin payout produces **no** editor notification | PASS |

### 3.2 Scenario S2 — Short project / existing client / reopen cycle
*Owner direct-assigns Short to editor; editor accepts, submits; owner completes; owner reopens; editor submits V2; owner re-completes; both payouts paid.*

| # | Check | Result |
|---|---|---|
| S2.1 | Create with existing client + direct assign → `assigned`, type `Short`, editor amount 2500 | PASS |
| S2.2 | Editor accepts → `ongoing` | PASS |
| S2.3 | Submits V1 → `submitted` | PASS |
| S2.4 | Owner completes | PASS |
| S2.5 | Owner reopens → `ongoing`, "Reopened" timeline entry, `reopened` notification to editor | PASS |
| S2.6 | Editor uploads V2; versions preserved (`1,2`) | PASS |
| S2.7 | Owner completes again; "Completed" appears twice in timeline | PASS |
| S2.8 | Both payments marked paid; financials unchanged | PASS |

### 3.3 Scenario S3 — Wrong-editor reassignment
*Project created via JR Admin, assigned to wrong editor, reassigned via edit.*

| # | Check | Result |
|---|---|---|
| S3.1 | Admin assigns wrong editor, then reassigns to editor2 via project edit | PASS |
| S3.2 | Editor2 gets `project_assigned` notification | PASS |
| S3.3 | Timeline: `Updated` + `Assigned` entries | PASS |
| S3.4 | Editor amount set via edit (3000) | PASS |
| S3.5 | Previous editor loses access (redirect); new editor can view | PASS |

### 3.4 Scenario S4 — Edit submitted version until approval
*Editor submits draft, edits it in place, owner approves.*

| # | Check | Result |
|---|---|---|
| S4.1 | Submit V1, then edit submitted V1 → same version (no bump), drive link updated in place | PASS |
| S4.2 | "Updated" timeline entry recorded | PASS |
| S4.3 | Owner completes; version history intact (V1 only) | PASS |

### 3.5 Scenario S5 — Reopen/continue/complete portals (UI render)
| # | Check | Result |
|---|---|---|
| S5.1 | Owner portal: completed project shows both payment statuses | PASS |
| S5.2 | Admin portal: sees both paid statuses, **no** Mark Paid buttons | PASS |
| S5.3 | Editor portal: "Paid" badge visible, no payment actions | PASS |

### 3.6 Permissions (role gates)
| # | Check | Result |
|---|---|---|
| P.1 | **Admin → POST payment-done/admin → 403** `"Only the Owner can mark payment to Admin."` | PASS |
| P.2 | 403 leaves existing paid record untouched | PASS |
| P.3 | Admin → payment-done/admin on pending project → 403, status stays `pending` | PASS |
| P.4 | **Admin → payment-done/editor → allowed (200)** | PASS |
| P.5 | Editor → payment-done → blocked (302) | PASS |
| P.6 | Editor → /admin/workspace → blocked (302) | PASS |
| P.7 | Editor → complete project → blocked (302) | PASS |
| P.8 | Editor viewing other editor's project → blocked | PASS |
| P.9 | Editor → transition → blocked (302) | PASS |
| P.10 | Editor accept on non-assigned status → 400 | PASS |
| P.11 | Client → /admin/workspace, payment-done, /editor/projects → all blocked (302) | PASS |
| P.12 | Editor-payments module: admin-only (owner blocked 302, admin 200) | PASS |

### 3.7 Earnings & Ledger
| # | Check | Result |
|---|---|---|
| E.1 | Ledger renders client/editor/profit for completed projects | PASS |
| E.2 | Completed-but-unpaid project shows "Pending" | PASS |
| E.3 | Editor earnings page renders; paid amounts shown | PASS |

### 3.8 UI pages, search & filters
| # | Check | Result |
|---|---|---|
| U.1 | Workspace, Projects, Clients, Editors, Profits, Payment Status, Editor Payments (admin) all render 200 | PASS |
| U.2 | Type filter (Long) + search `q=TEST` → only Long projects | PASS |
| U.3 | Short filter excludes Long projects | PASS |
| U.4 | Clients page lists both existing + auto-created clients | PASS |

### 3.9 Financial integrity
| # | Check | Result |
|---|---|---|
| F.1 | S3 amounts unchanged after editor payment (10000/3000) | PASS |
| F.2 | S4 amounts unchanged (6000/1500) | PASS |
| F.3 | S1 profit = client − editor (12000 − 0) | PASS |
| F.4 | Editor Payments module amounts consistent with editor payouts | PASS |

### 3.10 Database integrity
| # | Check | Result |
|---|---|---|
| D.1 | Exactly 4 QA projects, no duplicates | PASS |
| D.2 | No orphan refs; all timelines non-empty; payout statuses valid (`pending`/`paid`) | PASS |
| D.3 | Every timeline entry has action + user | PASS |
| D.4 | No duplicate QA clients | PASS |

### 3.11 Regression suites
| Suite | Result |
|---|---|
| Unit tests (`node --test tests/unit/*.test.mjs`) | **28/28 PASS** |
| Playwright (`bash tests/run.sh`) | **78 PASS / 1 FAIL** (see Bug 2 — pre-existing, test-ordering only) |

---

## 4. Bugs Found

### Bug 1 — Client login causes infinite redirect loop
- **Severity:** High (functional, client portal unreachable via login)
- **Status:** Pre-existing (predates this release — present in `dashboardForRole`, untouched by release changes)
- **Steps:** Sign up or log in as a `client`-role user → browser follows `/login` success redirect to `/` → `app.get("/")` sees `role === "client"` and redirects back to `/` → `ERR_TOO_MANY_REDIRECTS`.
- **Expected:** Client lands on their portal (`/projects`, which renders `views/client/projects`).
- **Actual:** `dashboardForRole(client)` returns `"/"` (routes/auth.js:11) and `GET /` re-redirects clients to `"/"` (server.js:85-91) — infinite loop.
- **Suggested fix:** return `"/projects"` for `client` in `dashboardForRole` (one line, routes/auth.js:11).

### Bug 2 — Playwright flake: "Editor can view both links (read-only)" (tests/workflow.spec.mjs:315)
- **Severity:** Low (test-only, no product defect)
- **Status:** Pre-existing — reproduced before this release's changes; **not** caused by this release.
- **Root cause (identified this run):** test-ordering dependency. `tests/reopen.spec.mjs` runs first (alphabetical, workers=1) and drives the shared seed project "Direct Assign Project" through accept → submit → complete → **reopen**, leaving it `ongoing`. The later `workflow.spec.mjs` test looks for that card in the **"My Projects" (assigned)** tab, which is now empty → locator resolved but "element is not visible" → 60s timeout.
- **Evidence:** page snapshot shows "My Projects 0 · Ongoing 4 · Completed 2"; the card exists in the hidden Ongoing tab.
- **Suggested fix:** in the test, click the card via whichever tab it currently lives in (e.g. `goto("?tab=ongoing")` fallback), or make `reopen.spec.mjs` use its own seeded project instead of the shared "Direct Assign Project".

---

## 5. Screenshots

Captured during this QA run (Chromium 1440×900, full-page). Also in `qa-screenshots/`:

| File | View |
|---|---|
| `01-owner-workspace.png` | Owner workspace with `Pay Admin` / `Pay Editor` quick actions |
| `02-project-detail-owner.png` | Completed project detail — both payment sections with Mark Paid buttons (owner) |
| `03-payment-status.png` | Payment Status page — Admin Payment + Editor Payment columns |
| `04-profits-ledger.png` | Earnings Ledger (client / editor / profit, per-project status) |
| `05-project-detail-admin.png` | Same project as admin — paid statuses shown, **no** Mark Paid buttons |
| `06-editor-payments-admin.png` | Editor Payments module (admin-only) with outstanding summary |
| `07-editor-earnings.png` | Editor earnings page |
| `08-editor-project-view.png` | Editor project view (read-only, no payment actions) |

Playwright failure artifacts (Bug 2 only): `test-results/workflow-Project-Drive-Lin-*/` (screenshot, trace, video, error-context).

---

## 6. Performance Notes

Timings measured on the E2E run (localhost, in-memory DB — indicative only, not a benchmark):

| Operation | Time |
|---|---|
| POST /admin/projects (create) | 24 ms |
| GET /admin/workspace | 10 ms |
| GET /admin/projects?filter=completed&q=TEST | 11 ms |
| GET /admin/payment-status | 8 ms |
| GET /admin/editor-payments | 8 ms |
| GET /admin/profits | 11 ms |
| GET /editor/earnings | 7 ms |

Threshold for all: < 2000 ms. All well under budget. No N+1 queries, no duplicated queries, no dead code found in the touched paths.

---

## 7. Code Health

- Role gates verified end-to-end: `editor`/`client`/`admin`/`owner` — no weakened permissions.
- Payment logic centralized in `utils/workflow.js` (`markPayoutPaid`, `isPayoutPaid`) — no copy-paste forks; route handlers thin.
- Schema enums (`models/Project.js` timeline actions, `models/Notification.js` types) verified against every new string introduced by the release — no `ValidationError` paths.
- `node --check` clean on all modified files; unit suite (28) covers payout nesting + financial summary.
- No dead imports/branches found in modified files.

---

## 8. Recommendations

**Release verdict: YES — approve release (commit `484713c`).**

Blockers: **none.**

Recommended follow-ups (non-blocking):
1. Fix Bug 1 (client login redirect, one-liner in `routes/auth.js`) in a separate change and add a small Playwright assertion (client login lands on `/projects`).
2. Fix Bug 2 test ordering (reopen spec should not mutate the shared seed project) to stabilize CI.

**QA sign-off:** All release-scope functionality verified 108/108 E2E + 28/28 unit; 78/79 Playwright with the single failure attributed to a pre-existing test-ordering issue (Bug 2).
