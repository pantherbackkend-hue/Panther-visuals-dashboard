# Project

**Panther Corporation Dashboard**

A project management platform for Panther Corporation creative studio. Admin creates projects, assigns editors, tracks work through submission/feedback cycles, and manages payment status.

**Current MVP Goal**: Working admin + editor + owner workflow with versioned submissions, structured feedback, payment tracking, and profit analytics.

**Business Objective**: Replace manual coordination (chat/email) with a centralized dashboard for project assignment, progress tracking, versioned submission cycles, and payment status.

---

# Architecture

**Backend**: Node.js (Express) with ES modules, EJS templates

**Frontend**: Server-rendered EJS views, vanilla CSS (`public/styles.css`)

**Database**: MongoDB (Mongoose ODM)

**Authentication**: Session-based (express-session + connect-flash), bcrypt password hashing

**Realtime**: Socket.IO — dashboard updates, project counts, notifications

**Roles**: `admin` (JR Admin) | `owner` (Super Admin) | `editor`

---

# Models

- **User** — name, email, passwordHash, role (`client`|`editor`|`admin`|`owner`), shop, availability, isActive
- **Project** — client (name/email/phone/notes), projectName, assignedEditor, driveLink, priority, dueDate, notes, status, submissions[], feedback[], payment { amount, clientAmount, editorAmount, status, paidAt, paidBy, upiId }, activityTimeline[], ownerAssignment (null|"admin"|"direct"), ownerAdmin, createdBy, completedAt
- **Notification** — recipient, recipientRole, type (enum), title, message, project ref, read, readAt, channel
- **Shop** — name, slug, description, image, vendor ref, paymentGateway/paymentSettings, isOpen, isActive

---

# Folder Structure

```
server.js            — Entry point, middleware setup, route mounting
config/              — db.js (MongoDB), cloudinary.js
middleware/          — auth.js, requireDb.js, upload.js
models/              — User.js, Project.js, Shop.js, Notification.js
routes/              — auth.js, admin.js, workflow.js, owner.js
socket/              — index.js (initSocket, getIO)
utils/               — workflow.js, admin.js, notifications.js
views/               — auth/, admin/, editor/, partials/
public/              — styles.css
```

---

# Roles & Permissions

| Action | owner | admin | editor |
|--------|-------|-------|--------|
| View all projects | YES | YES | assigned only |
| Create project | YES | YES | NO |
| Edit project | YES | restricted on owner projects | NO |
| Delete project | YES | pending_assignment only | NO |
| Assign editors | YES | YES | NO |
| Change editor payment | YES | YES (on owner projects only) | NO |
| Change client amount | YES | NO (on owner projects) | NO |
| Complete workflow | YES | YES | NO |
| Mark payment done | YES | YES | NO |
| View analytics | YES | NO | NO |
| View profits | YES | NO | NO |
| View all users | YES | NO | NO |
| View/manage shops | YES | YES | NO |
| View/manage editors | YES | YES | NO |
| Accept project | NO | NO | YES |
| Submit version | NO | NO | YES |
| View own projects | NO | NO | YES |

---

# Workflow

1. **Owner** or **Admin** logs in → redirected to `/admin/workspace`
2. **Owner** creates a project with assignment type:
   - **Assign to JR Admin**: JR Admin sees project, assigns editor, changes editor payment only
   - **Assign directly to Editor**: Editor workflow starts immediately
   - **Standard**: Existing admin workflow
3. **Admin** creates/edits projects normally, with restriction on owner-assigned projects (can only change editorAmount)
4. **Project** status pipeline: `pending_assignment` → `assigned` → `ongoing` ↔ `submitted` → `completed`
5. **Editor** accepts, submits, receives feedback (unchanged)
6. **Admin/Owner** completes project and marks payment done
7. **Profit** = `payment.clientAmount - payment.editorAmount` (never stored, always calculated)

---

# Owner-Only Features

- `/admin/analytics` — Platform-wide analytics (users, projects, revenue, costs, profit)
- `/admin/profits` — Profit breakdown per project
- `/admin/users` — All users across roles
- Profit metrics on dashboard
- Client/Editor Amount and Profit display on project detail
- Owner assignment options on project creation (Assign to JR Admin / Direct to Editor)

---

# Super Admin Implementation

**Date**: 13 July 2026

**Objective**: Implement Super Admin layer on top of existing JR Admin workflow. Preserve 100% of existing functionality. No duplicated dashboards. No copied pages.

## Model Changes

- **Project model**: Added `ownerAssignment` (enum: `"admin"`, `"direct"`, null) and `ownerAdmin` (ObjectId ref User)
- **Payment subdoc**: Added `clientAmount` and `editorAmount` alongside existing `amount` for backward compatibility
- Profit never stored — always calculated as `clientAmount - editorAmount`

## Routes Added

- `routes/owner.js` — `/admin/profits`, `/admin/analytics`, `/admin/users` (owner-only)

## Routes Modified

- `routes/workflow.js` — Project create handles ownerAssignment, clientAmount, editorAmount; edit route restricts admin changes on owner projects; payment uses correct amount
- `routes/admin.js` — Dashboard passes profit stats for owner; workspace assign handles `editorAmount` for owner projects; sets `clientAmount` for non-owner projects

## Views Added

- `views/admin/profits.ejs` — Profit overview table
- `views/admin/analytics.ejs` — Platform analytics
- `views/admin/users.ejs` — All users list

## Views Modified

- `views/admin/projects/form.ejs` — Owner assignment radio buttons (Assign to JR Admin / Direct to Editor / Standard), separate Client Amount and Editor Amount fields
- `views/admin/projects/show.ejs` — Owner assignment badge, profit display, client/editor amount breakdown
- `views/admin/projects/index.ejs` — Assignment column for owner
- `views/admin/workspace.ejs` — Owner assignment label on project cards
- `views/admin/dashboard.ejs` — Profit metrics row for owner
- `views/admin/partials/sidebar.ejs` — Analytics/Profits/Users links for owner only

## Socket.IO / Notifications

- `broadcastNotification` forwards admin-targeted notifications to owner role
- `broadcastDashboardUpdate` and `broadcastProjectCounts` emit to both `role:admin` and `role:owner`

## Verification

| Check | Result |
|-------|--------|
| Syntax validation (all JS files) | PASS |
| EJS compile (all 27 views) | PASS |
| Server startup (0 errors, port 7000) | PASS |
| Route smoke test (31 routes) | PASS |
| Public routes (/, /login, /signup) | 200 |
| Auth-protected routes (unauthenticated) | 302 |
| Static files (CSS, images) | 200 |
| 404 handler | 404 |

## Backward Compatibility

- Existing `payment.amount` field preserved — all views that reference it still work
- Existing projects without `ownerAssignment` field continue to function normally
- Existing admin workflow completely unchanged
- `ownerAssignment` defaults to `null` for backward compatibility
- `requireAdmin` middleware continues to allow both `admin` and `owner` roles
- All existing routes, transitions, editor workflow, payments, and socket events preserved

---

# Editor UI Security

**Date**: 14 July 2026

**Objective**: Restrict financial information visible to editors to only what they need — their payable amount.

## Changes Made

- `views/editor/projects/show.ejs` — Replaced "Payment Amount" (showing `payment.amount`, the client budget) with "Payable Amount" (showing `payment.editorAmount`). Added "Payment Status" badge and conditional "Paid At" row. Editors no longer see client-facing financial data.
- `views/editor/projects/index.ejs` — Changed "Amount" label to "Payable Amount" across all three tabs (assigned, ongoing, completed). Now displays `payment.editorAmount` instead of `payment.amount`.

## What Was NOT Changed

- Admin project detail (`views/admin/projects/show.ejs`) — untouched; admin/owner still see Client Amount, Editor Amount, Profit, Payment Status
- Admin project list — untouched
- Admin dashboard, profits, analytics — untouched
- Owner profit/analytics pages — untouched
- Routes, middleware, permissions, database schema — none modified
- Editor workflow (accept, submit, feedback, transitions) — unchanged

## Verification

| Check | Result |
|-------|--------|
| EJS compile (show.ejs) | PASS |
| EJS compile (index.ejs) | PASS |
| Node.js syntax check (all JS files) | PASS |
| Server startup (0 errors, port 7000) | PASS |

---

# Legacy Workspaces Cleanup

**Date**: 14 July 2026

**Objective**: Remove the obsolete "Workspaces" (plural) concept. The product uses one singular "Workspace" concept.

## Files Deleted (4)

| File | Reason |
|------|--------|
| `models/Shop.js` | Entire Shop (workspace) model — zero remaining dependents |
| `views/admin/shops/index.ejs` | Workspaces list page — obsolete CRUD |
| `views/admin/shops/show.ejs` | Workspace detail page — obsolete CRUD |
| `views/admin/shops/form.ejs` | Workspace create/edit form — obsolete CRUD |

## Files Modified (11)

| File | Changes |
|------|---------|
| `routes/admin.js` | Removed `Shop` import, `syncVendorShopLink` helper, all 8 shops CRUD routes (~190 lines), `safeSlug` helper, `totalShops` dead stat, shop field from editor CRUD (create, edit, delete, list, detail) |
| `views/admin/vendors/form.ejs` | Removed "Assigned Workspace" dropdown |
| `views/admin/vendors/show.ejs` | Removed "Assigned Workspace" card |
| `views/admin/vendors/index.ejs` | Removed "Workspace" column, adjusted colspan |
| `views/partials/header.ejs` | Removed dead `<a href="/workspaces">Workspaces</a>` nav link |
| `views/home.ejs` | Removed 3 dead Workspaces links, replaced admin/owner "Workspaces" with "Workspace" → `/admin/workspace` |
| `views/admin/partials/sidebar.ejs` | Removed "Workspaces" nav link to `/admin/shops` |
| `middleware/upload.js` | Removed `uploadShopImage`, `handleShopImageUpload`, `shopImageStorage` import |
| `config/cloudinary.js` | Removed `shopImageStorage` |
| `public/styles.css` | Renamed `.editor-workspace*` → `.editor-layout*` |
| `views/editor/projects/show.ejs` | Renamed CSS classes `editor-workspace*` → `editor-layout*` |

## Dead Code Removed

- `syncVendorShopLink` bidirectional helper (150+ lines)
- `safeSlug` slug generator
- `Shop.countDocuments()` in dashboard (computed but never rendered)
- `totalShops` stat passed to dashboard view
- `uploadShopImage` multer configuration
- `handleShopImageUpload` middleware wrapper
- `shopImageStorage` Cloudinary storage config
- All shop-related `assignedShopName` mapping in editor list
- All shop-related `populate()` calls in editor detail/edit routes
- All `syncVendorShopLink` calls in editor create/edit/delete routes

## Architecture Cleanup

- **Concept**: "Workspaces" (plural, multi-workspace management) completely removed
- **Concept**: "Workspace" (singular, operational center) remains untouched
- **DB schema**: `User.shop` field kept dormant for backward compatibility (existing documents have it, zero code references it)
- **Routes removed**: `GET /admin/shops`, `GET /admin/shops/new`, `POST /admin/shops`, `GET /admin/shops/:id`, `GET /admin/shops/:id/edit`, `POST /admin/shops/:id/edit`, `POST /admin/shops/:id/toggle`, `POST /admin/shops/:id/delete`
- **Routes preserved**: `GET /admin/workspace`, `POST /admin/workspace/assign`
- **Header/Welcome page**: Dead `/workspaces` links removed (that route never existed)

## Smoke Test Results

| Check | Result |
|-------|--------|
| Node.js syntax (all JS files) | PASS |
| EJS compile (all templates) | PASS |
| Server startup (port 7000) | PASS |
| `GET /` (public) | 200 |
| `GET /login` / `GET /signup` | 200 |
| `GET /workspaces` (dead route) | 404 |
| `GET /admin/shops` (removed route) | 302 (auth wall) → 404 after login |
| `GET /admin/workspace` (auth wall) | 302 |
| Static assets (`/styles.css`) | 200 |
| 404 handler | 404 |

## Full Repository Search — Remaining Occurrences

| Term | Remaining | Status |
|------|-----------|--------|
| `workspace` (singular) | 15 | All legitimate — operational routes, UI, documentation |
| `workspaces` (plural) | 0 | Fully removed |
| `Shop` / `shop` (model) | 1 | `User.shop` field — kept dormant for backward compat |
| `/admin/shops` | 0 | Fully removed |
| `uploadShopImage` | 0 | Fully removed |
| `handleShopImageUpload` | 0 | Fully removed |
| `shopImageStorage` | 0 | Fully removed |

---

---

# Financial Responsibility Refactor (Owner → JR Admin)

**Date**: 16 July 2026

**Objective**: Shift financial responsibility from Owner to JR Admin. Owner only manages Client Amount. JR Admin manages Editor Amount, Earnings, and editor payments.

## New Financial Ownership Model

| Responsibility | Owner | JR Admin |
|---------------|-------|----------|
| Set Client Amount | YES | NO (read-only on owner projects) |
| Set Editor Amount | NO | YES |
| Pay Editor | NO | YES |
| View Earnings | NO | YES |
| View Profit | NO (replaced by Earnings) | YES |

**Earnings** = `payment.clientAmount - payment.editorAmount` (calculated dynamically, never stored)

## Files Modified (8)

| File | Changes |
|------|---------|
| `routes/workflow.js` | Owner project creation no longer sets `editorAmount` (defaults to 0). Owner edit no longer modifies `editorAmount`. |
| `routes/admin.js` | Added `/admin/profits` route (Earnings page) for admin only. Dashboard `profitStats` now queries for `admin` role instead of `owner`. |
| `routes/owner.js` | Removed `/admin/profits` route (moved to admin.js). Analytics no longer calculates `totalEditorAmount` or `totalProfit`. |
| `views/admin/projects/form.ejs` | Owner creation/edit: Only shows "Client Amount" field. Admin on owner projects: Shows read-only "Client Amount" + editable "Editor Amount". Admin on standard: Shows "Payment Amount". |
| `views/admin/projects/show.ejs` | Owner: Only sees "Client Amount" (no Editor Amount, no Earnings). Admin: Sees "Client Amt", "Editor Amt", "Earnings". Editor Amt/Earnings hidden from owner in metrics, overview, and payment sections. |
| `views/admin/dashboard.ejs` | Profit metrics section now renders only for `currentUser.role === "admin"`. Label "Net Profit" changed to "Earnings". |
| `views/admin/analytics.ejs` | Removed "Editor Costs", "Net Profit" metric cards. Kept "Client Revenue", "Payments Made". |
| `views/admin/partials/sidebar.ejs` | Owner sidebar: Removed "Profits" link. Admin sidebar: Added "Earnings" link to `/admin/profits`. |
| `views/admin/profits.ejs` | Title changed from "Profit Overview" to "Earnings Overview". "Total Profit" → "Total Earnings". "Profit Breakdown" → "Earnings Breakdown". |

## Files NOT Modified (28)

- `models/Project.js` — Schema unchanged (`payment.clientAmount`, `payment.editorAmount`, `payment.amount` all preserved)
- `models/User.js` — No changes
- `models/Notification.js` — No changes
- `middleware/auth.js` — No changes
- `utils/workflow.js` — No changes
- `utils/admin.js` — No changes
- `utils/notifications.js` — No changes
- `socket/index.js` — No changes
- `server.js` — No changes
- `routes/auth.js` — No changes
- `views/admin/projects/index.ejs` — Unchanged (Amount column uses `paymentAmount`)
- `views/admin/workspace.ejs` — Unchanged
- `views/admin/users.ejs` — Unchanged
- `views/admin/vendors/*` — Unchanged (3 vendor views)
- `views/admin/partials/layout-*.ejs` — Unchanged (2 layout partials)
- `views/editor/projects/show.ejs` — Unchanged (editor sees Payable Amount)
- `views/editor/projects/index.ejs` — Unchanged (editor sees Payable Amount)
- `views/editor/assets.ejs` — Unchanged
- `views/editor/profile.ejs` — Unchanged
- `views/partials/*` — Unchanged (3 partials)
- `views/auth/*` — Unchanged
- `views/home.ejs` — Unchanged
- `public/styles.css` — Unchanged

## Permission Changes

| Asset | Before | After |
|-------|--------|-------|
| `/admin/profits` | Owner only | Admin only |
| `/admin/analytics` | Owner only | Owner only (unchanged) |
| `/admin/users` | Owner only | Owner only (unchanged) |
| Owner sidebar Profits link | Visible | Removed |
| Admin sidebar Earnings link | Hidden | Visible |
| Editor Amount in form | Owner + Admin on owner projects | Admin only |
| Editor Amount on detail | Owner (when `showProfit`) | Admin only |
| Profit on detail | Owner (when `showProfit`) | Admin (renamed to Earnings) |

## Earnings Calculation

```
Earnings = payment.clientAmount - payment.editorAmount
```

- Calculated in: `routes/admin.js` (dashboard), `routes/admin.js` (profits page), `routes/workflow.js` (project show)
- Never stored in database
- `payment.clientAmount` and `payment.editorAmount` remain persisted on the Project model

## Validation Performed

| Check | Result |
|-------|--------|
| Syntax validation (all 12 JS files) | PASS |
| Server startup (0 errors, port 7000) | PASS |
| Route smoke test (all 30+ routes) | PASS |
| Public routes (/, /login, /signup) | 200 |
| Auth-protected routes (unauthenticated) | 302 |
| Static assets (/styles.css) | 200 |
| 404 handler | 404 |

## Current Architecture

**Owner** creates project → sets **Client Amount** → assigns to **JR Admin** (or directly to **Editor**).

**JR Admin** views **Client Amount** (read-only) → sets **Editor Amount** → assigns **Editor** → manages workflow → pays **Editor**.

**Editor** sees only **Payable Amount** (`payment.editorAmount`).

**Earnings** = Client Amount − Editor Amount, always calculated dynamically, visible only to JR Admin on `/admin/profits`.

---

# Pre-Assignment Review for JR Admin

**Date**: 16 July 2026

**Objective**: Allow JR Admin to review and edit project details before assigning an editor. Previously, JR Admin was forced to assign an editor immediately before making any edits.

## Workflow Enhancement

**Before:**
```
Owner creates project → Assigns JR Admin → JR Admin assigns Editor → Only then can edit
```

**After:**
```
Owner creates project → Assigns JR Admin → JR Admin reviews + edits → Assigns Editor → Normal workflow
```

## Files Modified (2)

| File | Changes |
|------|---------|
| `views/admin/workspace.ejs` | Added `[Edit Project]` button on workspace cards where `ownerAssignment === "admin"` and `status === "pending_assignment"`. Button links to existing `/admin/projects/:id/edit` route. Hidden after editor is assigned. |
| `routes/workflow.js` | Updated edit POST route. New `canAdminEditOwnerProject` flag allows admin to edit client/project details on owner projects **only while** `status === "pending_assignment"`. After assignment, existing restrictions apply. |

## Files NOT Modified (all other files)

- Models, middleware, utils, socket, server, auth routes, owner routes, admin routes (except profits), all other views, CSS — untouched.

## Permission Enforcement

| Action | Owner | Admin (pre-assignment) | Admin (post-assignment) |
|--------|-------|----------------------|------------------------|
| Edit Client Name/Email/Phone | YES | YES | NO |
| Edit Project Name | YES | YES | NO |
| Edit Drive Link | YES | YES | NO |
| Edit Priority | YES | YES | NO |
| Edit Due Date | YES | YES | NO |
| Edit Notes | YES | YES | NO |
| Edit Editor Amount | NO (removed) | YES | YES |
| Edit Client Amount | YES | NO | NO |
| View/Edit Owner Assignment | YES | NO | NO |

## Validation

| Check | Result |
|-------|--------|
| Syntax validation (all JS files) | PASS |
| Server startup (0 errors, port 7000) | PASS |
| Public routes (/, /login, /signup) | 200 |
| Auth-protected routes (unauthenticated) | 302 |
| Static assets (/styles.css) | 200 |
| 404 handler | 404 |

## Architecture

The pre-assignment review is a UI-only permission toggle at the route level:
- **View layer**: Edit button conditionally rendered based on `ownerAssignment` and `status`
- **Route layer**: `canAdminEditOwnerProject` flag controls write access to client/project fields
- **Financial layer**: Unchanged — admin can only edit `editorAmount`, never `clientAmount`
- **Workflow pipeline**: Fully preserved — no status transitions, socket events, or notification logic modified

# Technical Debt

- `User` model has `client` role in enum — unused
- `Notification` model has `email`/`whatsapp` channels — unused
- `resetPasswordToken` / `resetPasswordExpires` on User — never set
- No input sanitization beyond `trim()`
- No automated test suite
- Views reference `project.clientName` and `project.paymentAmount` as fallbacks
- `getDashboardCounts` includes deprecated keys (`new`, `revision`, `payment`, `paid`)
- Admin signup not exposed through UI (admins created via DB)
- Workspace filtering is client-side only

---

# AI Instructions

- Reuse existing architecture — don't rebuild working systems
- Keep UI simple — no design overhauls
- Maintain stability — don't remove what works
- Always update STATUS.md after every prompt
- Use the existing workflow pipeline — don't invent new status systems
- Don't reintroduce removed FlashFoods features
- Workspace features removed: shops CRUD, editor–workspace assignment, vendor/shop sync
- Version/submission tracking remains unbounded — version = `submissions.length + 1`
- Keep `STATUS.md` under 500 lines
