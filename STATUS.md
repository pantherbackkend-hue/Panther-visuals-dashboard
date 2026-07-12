# Project

**Panther Visuals Dashboard**

A project management platform for Panther Visuals creative studio. Admin creates projects, assigns editors, tracks work through submission/feedback cycles, and manages payment status.

**Current MVP Goal**: Working admin + editor workflow with versioned submissions, structured feedback, and payment tracking.

**Business Objective**: Replace manual coordination (chat/email) with a centralized dashboard for project assignment, progress tracking, versioned submission cycles, and payment status.

---

# Current Architecture

**Backend**: Node.js (Express) with ES modules, EJS templates

**Frontend**: Server-rendered EJS views, vanilla CSS (`public/styles.css`)

**Database**: MongoDB (Mongoose ODM) — `mongodb+srv://` cluster

**Authentication**: Session-based (express-session + connect-flash), bcrypt password hashing

**Realtime**: Socket.IO — dashboard updates, project counts, notifications

**Roles**: `admin` | `owner` | `editor`

**Current Models**:
- `User` — name, email, passwordHash, role, shop (optional), availability, isActive
- `Project` — client (name/email/phone/notes), projectName, assignedEditor, driveLink, priority, dueDate, notes, status, submissions[], feedback[], payment { amount, status, paidAt, paidBy, upiId }, activityTimeline[], createdBy, completedAt
- `Notification` — recipient, recipientRole, type (enum), title, message, project ref, read, readAt
- `Shop` — name, slug, description, image, vendor ref, paymentGateway/paymentSettings, isOpen, isActive

**Folder Structure**:
```
server.js            — Entry point, middleware setup, route mounting
config/              — db.js (MongoDB), cloudinary.js
middleware/          — auth.js (attachUser, requireAuth, requireAdmin, requireEditor), requireDb.js, upload.js
models/              — User.js, Project.js, Shop.js, Notification.js
routes/              — auth.js, admin.js, workflow.js
socket/              — index.js (initSocket, getIO)
utils/               — workflow.js (statuses, transitions, helpers), admin.js, notifications.js
views/               — auth/, admin/, editor/, partials/
public/              — styles.css
```

---

# Current Workflow

1. **Admin** logs in → redirected to `/admin/workspace`
2. **Admin** creates a Project from the Projects page (client info, project name, optional editor assignment, priority, due date, notes, payment amount)
3. **Project** starts as `pending_assignment`
4. **Admin** uses the Workspace to monitor all projects, filter by status/priority/editor, and assign editors
5. **Admin** assigns editor (`pending_assignment` → `assigned`) via inline assign on project cards or Quick Assign form → editor notified via Socket.IO
6. **Editor** logs in → sees assigned projects at `/editor/projects`
7. **Editor** accepts (`assigned` → `ongoing`) — notifies admin
8. **Editor** submits work (`ongoing` → `submitted`) with drive link + description → system appends submission with auto-incremented version number
9. **Admin** reviews in Workspace (submitted tab); if changes needed, provides feedback (`submitted` → `ongoing`) with comment + optional drive link; if satisfied, completes project (`submitted` → `completed`)
10. Editor sees feedback, uploads again → next version, loop repeats
11. **Admin** marks project completed → project moves to `completed`
12. **Admin** manually pays Editor → updates payment status (`payment.status` = `paid`, records paidAt/paidBy/UPI)
13. **Admin** clicks Payment Done → system updates payment record (WhatsApp message integration pending)

**Status Pipeline**:
`pending_assignment` → `assigned` → `ongoing` ↔ `submitted` → `completed`

**Payment Pipeline** (separate from project status):
`payment.status`: `pending` → `paid`

---

# Current Features

- Session-based auth (signup, login, logout)
- Admin workspace dashboard with project metrics
- Project CRUD (create, read, update, delete)
- Editor assignment and reassignment
- Workspace operations center with project cards, inline assign, filters
- Editor accept workflow (accept project → moves to ongoing)
- Unlimited versioned submissions (auto-incrementing, no cap)
- Structured feedback per version
- Activity timeline on every project
- Socket.IO live dashboard updates
- In-app notifications (admin + editor)
- Shop/Workspace CRUD for admin
- Editor account management (create, edit, toggle, delete)
- Cloudinary image upload for shop assets
- Global search API (projects + editors)
- Submission history table with version tracking
- Feedback history table with version references
- Project filtering by status, priority, editor, search, and due date sort
- Project search by name, client, editor, or ID

---

# Removed Features

- Payment gateways (Razorpay, Easebuzz, PhonePe)
- Client/customer ordering portal
- Food/Menu ordering system
- Menu import tools
- OTP verification
- Password reset (email-based)
- Email sending utilities
- Order management (status, tracking)
- Analytics/reports dashboards
- Boss Admin role
- Public workspace pages
- Fixed 3-revision cap
- Revision statuses (`revision_1/2/3`, `revision`, `accepted_by_editor`, `working`, `waiting_for_payment`, `archived`)
- `revisionCounter`/`revisionHistory` fields (replaced with `submissions[]` + `feedback[]`)
- Editor reject workflow
- `new_project` status
- Project status as payment tracker (payment now uses separate subdocument)

---

# Current Technical Debt

- `Shop` model retains legacy fields: `paymentGateway`, `paymentSettings`, `vendor`, `isOpen` — not used by MVP but not breaking anything
- `User` model still has `client` role in enum — unused
- `Notification` model still has `email` and `whatsapp` channels — unused
- `resetPasswordToken` / `resetPasswordExpires` fields on User model — never set
- `User` model has `shop` field — not critical for current MVP but not breaking
- No input sanitization beyond basic `trim()`
- No automated test suite
- Views reference `project.clientName` and `project.paymentAmount` as fallbacks for backward compat
- `getDashboardCounts` includes deprecated keys (`new`, `revision`, `payment`, `paid`) for backward compat with templates
- Admin signup not exposed through UI (admins are created via DB directly)
- Workspace filtering is client-side only (fine for MVP scale, should move server-side for larger datasets)

---

# Current Sprint

**Objective**: Full QA Validation — Comprehensive regression test, smoke test, stability test, and codebase validation across 10 phases. Fix confirmed bugs only.

**Progress**: Completed

**Completed**: 100%

---

# Latest Iteration Summary

**Date**: 12 July 2026

**Objective**: Comprehensive polish of the existing MVP across 8 phases: Consistency, UX, Responsiveness, Accessibility, Performance, Code Cleanup, Stability, and Validation.

**Phase 1 — Consistency**:
- Added 30+ CSS utility classes (`mt-0`, `mb-16`, `text-sm`, `flex`, `gap-*`, `capitalize`, `full-width`, `fw-medium`, etc.)
- Removed ~70 inline styles across 8 view files, replaced with CSS classes
- Fixed heading hierarchy: auth pages now use `<h1>` instead of `<h2>` (login, signup)
- Updated `.auth-card__title` CSS to support `h1` element

**Phase 2 — UX Improvements**:
- Replaced `alert()` calls with inline `.alert-inline--error` messages in all JS handlers (editor accept, editor submit, admin feedback, admin workspace assign)
- Replaced `confirm()` with accessible custom dialog (`.confirm-overlay` + `.confirm-dialog`) in admin complete, payment-done, workspace busy-assign flows
- Added disabled/loading states to all form submit buttons
- Editor profile now uses AJAX with success/error inline feedback instead of page refresh

**Phase 3 — Responsiveness**:
- Added responsive breakpoints at 480px for `auth-card`, `payment-details`, `admin-detail-grid`
- Added `editor-tabs` overflow scroll for small screens
- Reduced `admin-page-head h1` size on small screens

**Phase 4 — Accessibility**:
- Added `role="tablist"`, `role="tab"`, `role="tabpanel"`, `aria-selected`, `aria-controls` to editor project tabs
- Added `role="table"`, `scope="col"` to all data table headers
- Added `role="complementary"` + `aria-label` to admin sidebar, `role="main"` to main content
- Added `aria-live="polite"` to workspace project grid
- Added `aria-modal`, `aria-labelledby` to custom confirm dialogs

**Phase 5 — Performance**:
- (Skipped heavy refactoring — notification query consolidation noted for future)

**Phase 6 — Code Cleanup**:
- Removed dead imports from `routes/workflow.js`: `getNotificationType`, `getPriorityWeight`, `getIO`
- (CSS dead class removal deferred to avoid breaking unknown references)

**Phase 7 — Stability**:
- Added `try/catch` blocks to 7 previously unprotected async route handlers:
  - `POST /admin/projects/:id/transition` (workflow.js)
  - `POST /admin/projects/:id/assign` (workflow.js)
  - `POST /admin/projects/:id/delete` (workflow.js)
  - `POST /editor/projects/:id/transition` (workflow.js)
  - `POST /admin/shops/:id/toggle` (admin.js)
  - `POST /admin/shops/:id/delete` (admin.js)
  - `POST /admin/editors/:id/toggle` (admin.js)
  - `POST /admin/editors/:id/delete` (admin.js)

**Phase 8 — Validation**:
- Syntax check: all JS files pass `node --check`
- EJS compile: all modified views pass EJS compilation
- Server startup: 0 errors on port 7000
- Routes verified: all mutation handlers registered correctly

**Files Modified**:
- `public/styles.css` — Added utility classes, spinner, alert-inline, confirm-dialog, responsive breakpoints
- `views/auth/login.ejs` — h1 heading, inline style → class
- `views/auth/signup.ejs` — h1 heading
- `views/editor/projects/index.ejs` — inline styles → classes, ARIA tabs, alert → inline error, loading states
- `views/editor/projects/show.ejs` — inline styles → classes, alert → inline error, loading states
- `views/editor/profile.ejs` — AJAX form with inline feedback, disabled/loading states
- `views/admin/projects/show.ejs` — inline styles → classes, confirm() → custom dialog, alert → inline error, ARIA table
- `views/admin/projects/index.ejs` — inline styles → classes, ARIA table scope
- `views/admin/workspace.ejs` — inline styles → classes, alert/confirm → custom dialog + inline error, ARIA live region
- `views/admin/partials/layout-start.ejs` — ARIA roles
- `routes/workflow.js` — Removed dead imports, added try/catch to 4 handlers
- `routes/admin.js` — Added try/catch to 4 handlers

---

# Latest Iteration Summary (Branding)

**Date**: 12 July 2026

**Objective**: Integrate the official Panther Visuals logo (`logo.jpeg`) throughout the application as the primary brand asset.

**Changes Made**:
- Copied `logo.jpeg` to `public/images/logo.jpeg` and `public/favicon.jpeg`
- Updated `views/partials/header.ejs`:
  - Replaced generic favicon (`/icon.png`) with logo-based favicon (`/images/logo.jpeg`)
  - Updated browser title format: `"Page Title | Panther Visuals"` (instead of `"Page Title - Panther Visuals"`)
  - Default title changed to "Panther Visuals Dashboard"
  - Replaced generic CSS icon (`::before` pseudo-element) with real `<img>` tag using logo
- Updated `views/auth/login.ejs` and `views/auth/signup.ejs`:
  - Added logo above the form title with `brand-logo--auth` class
- Updated `views/admin/partials/layout-start.ejs`:
  - Replaced plain text "Panther Visuals" sidebar title with clickable logo linked to workspace
- Updated `public/styles.css`:
  - Removed `.brand::before` pseudo-element (old icon)
  - Added `.brand-logo`, `.brand-logo--sidebar`, `.brand-logo--auth` classes
  - Added responsive sizing for logo at 768px and 480px breakpoints
- Added responsive logo scaling for mobile/tablet/desktop

**Verification**:
- Syntax: all modified JS files pass `node --check`
- EJS compile: all modified views pass compilation
- Server startup: 0 errors on port 7000
- Logo file exists at `public/images/logo.jpeg` (23 KB)
- Favicon file exists at `public/favicon.jpeg`
- No remaining references to old `/icon.png` in views or CSS

**Files Modified**:
- `views/partials/header.ejs` — Logo brand, favicon, title format
- `views/auth/login.ejs` — Auth page logo
- `views/auth/signup.ejs` — Auth page logo
- `views/admin/partials/layout-start.ejs` — Sidebar logo
- `public/styles.css` — Logo CSS classes, responsive sizing, removed old icon references

**Files Created**:
- `public/images/logo.jpeg` — Primary logo asset
- `public/favicon.jpeg` — Favicon logo asset

---

# Latest Iteration Summary (QA Validation)

**Date**: 12 July 2026

**Objective**: Complete QA validation of the entire application — static analysis, server validation, route smoke tests, authentication, full workflow regression, database integrity, edge cases, performance, and UI checks.

## PASS/FAIL Summary

| Test Area | Result |
|-----------|--------|
| Static Analysis | PASS |
| Server Startup | PASS |
| Route Smoke Test (12 routes) | PASS |
| Authentication (11 scenarios) | PASS |
| Full Workflow Regression (25 steps) | PASS |
| Database Validation | PASS |
| Edge Cases (14 scenarios) | PASS |
| Performance | PASS |

## Bugs Fixed

1. **Missing try/catch in auth POST handlers** (`routes/auth.js`):
   - `POST /signup` — async operations (User.findOne, bcrypt.hash, User.create) could throw unhandled promise rejections
   - `POST /login` — async operations (User.findOne, bcrypt.compare) could throw
   - **Fix**: Wrapped both handlers in try/catch blocks with flash error + redirect on failure

2. **Broken link in login page** (`views/auth/login.ejs`):
   - Login page had `<a href="/forgot-password">Forgot Password?</a>` but no `/forgot-password` route exists
   - **Fix**: Removed the link (password reset is not part of MVP)

## Routes Tested (all pass)

- `GET /` → 200 (home page)
- `GET /login` → 200
- `GET /signup` → 200
- `POST /login` → 302 (valid/invalid credentials both handled)
- `POST /signup` → 302 (new/duplicate both handled)
- `POST /logout` → 302
- `GET /admin` → 200 (authenticated) / 302 (unauthenticated)
- `GET /admin/workspace` → 200
- `GET /admin/projects` → 200
- `GET /admin/projects/new` → 200
- `GET /admin/projects/:id` → 200
- `GET /admin/projects/:id/edit` → 200
- `POST /admin/projects/:id/transition` → 302
- `POST /admin/projects/:id/assign` → 302
- `POST /admin/projects/:id/feedback` → 200
- `POST /admin/projects/:id/complete` → 200
- `POST /admin/projects/:id/payment-done` → 200
- `POST /admin/projects/:id/delete` → 302
- `GET /editor/projects` → 200
- `GET /editor/projects/:id` → 200
- `POST /editor/projects/:id/accept` → 200
- `POST /editor/projects/:id/submit` → 200
- `GET /editor/profile` → 200
- `GET /editor/assets` → 200
- `GET /api/notifications` → 200
- `GET /api/notifications/unread-count` → 200
- `POST /api/notifications/:id/read` → 200
- `POST /api/notifications/read-all` → 200
- `GET /api/projects/counts` → 200
- `GET /api/editor/projects/counts` → 200
- `GET /api/search` → 200
- `GET /styles.css` → 200
- `GET /images/logo.jpeg` → 200
- `GET /favicon.jpeg` → 200
- `GET /nonexistent` → 404

## Full Workflow Tested

1. ✅ Admin login → Workspace → Dashboard → Projects
2. ✅ View project details → Edit form → Transition status
3. ✅ Editor login → View projects → View project detail
4. ✅ Submit Version 1 → Status changes to "submitted"
5. ✅ Admin reviews submission → Sends feedback → Status back to "ongoing"
6. ✅ Editor submits Version 2 → Status back to "submitted"
7. ✅ Admin completes project → Status = "completed"
8. ✅ Admin marks payment done → payment.status = "paid"
9. ✅ View completed project with payment details
10. ✅ API counts, notifications, search all return correct data

## Database Integrity Verified

- Project: All fields populated (client, editor, status, submissions[2], feedback[1], payment{paid}, timeline[7])
- Submissions: Auto-incremented versions (1, 2), drive links preserved, timestamps correct
- Feedback: Comment stored with version reference
- Payment: amount, status=paid, paidAt, paidBy all recorded
- Editor: role=editor, isActive=true, upiId stored
- Notifications: 5 created for events (submission ×2, feedback, completion, payment)

## Edge Cases Handled (all pass)

- Invalid ObjectId → 302 with flash error
- Non-existent project → 302 with flash error
- Empty form → 302 back to form with validation error
- Duplicate payment → JSON error "Payment already completed."
- Invalid status transition → 302 with flash error
- Editor access to admin route → 302 redirect to home
- Editor access to wrong project → 302 redirect
- Accept completed project → JSON error "Project is not in assignable status."
- Submit to completed project → JSON error "Only ongoing projects can be submitted."
- Duplicate email signup → 302 with flash error
- Disabled account login → 302 with flash error
- Very long text → Stored correctly
- Missing drive link → Handled by client-side validation
- Logout → Session destroyed, protected routes redirect to login
- Back button after logout → Correctly redirects to login

## Remaining Technical Debt

- Workspace route uses 4 separate `countDocuments` calls (fine for MVP scale)
- `getDashboardCounts` includes deprecated keys (`new`, `revision`, `payment`, `paid`)
- `User` model has `shop`/`client` role leftover from legacy
- No automated test suite
- No input sanitization beyond `trim()`

## Verdict

**READY for client demonstration.** Zero syntax errors, zero runtime errors, zero broken routes, zero broken templates, zero failed workflows.

---

# Next Sprint

**Client Feedback Iteration** — Collect and integrate feedback from real users (admin + editors). Prioritize issues found in testing.

---

# AI Instructions

- Reuse existing architecture — don't rebuild working systems
- Keep UI simple — no design overhauls
- Maintain stability — don't remove what works
- Always update STATUS.md after every prompt
- Use the existing workflow pipeline — don't invent new status systems
- Don't reintroduce removed FlashFoods features (payment, cart, food ordering, etc.)
- All editor functionality should work without a workspace/shop assignment
- Version/submission tracking remains unbounded — version = `submissions.length + 1`
- Keep `STATUS.md` under 500 lines
