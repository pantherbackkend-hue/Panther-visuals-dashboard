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
| Change editor payment | NO | YES (on owner projects) | NO |
| Change client amount | YES | NO (on owner projects) | NO |
| Complete workflow | YES | YES | NO |
| Mark payment done | NO | YES | NO |
| View analytics | NO | YES | NO |
| View earnings | NO | YES | NO |
| View all users | NO | YES | NO |
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

- Owner assignment options on project creation (Assign to JR Admin / Direct to Editor)

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

---

# Owner Sidebar Cleanup

**Date**: 16 July 2026

**Objective**: Remove Analytics and All Users from the Owner sidebar. These are operational features that belong to the JR Admin. Move them to the Admin sidebar.

## Changes

| File | Changes |
|------|---------|
| `views/admin/partials/sidebar.ejs` | Removed `role === "owner"` block (Analytics + All Users). Moved Analytics, All Users into existing `role === "admin"` block alongside Earnings. |
| `routes/owner.js` | Updated middleware from `req.user.role !== "owner"` to `req.user.role !== "owner" && req.user.role !== "admin"` — allows admin to access `/admin/analytics` and `/admin/users`. |

## Sidebar After Changes

**Owner** sees:
```
Workspace
Dashboard
Editors
Manage Assets
Projects
Clients
```

**Admin** sees:
```
Workspace
Dashboard
Editors
Manage Assets
Projects
Clients
Analytics
Earnings
All Users
```

## What Was NOT Changed

- Analytics page (`views/admin/analytics.ejs`) — unchanged
- Users page (`views/admin/users.ejs`) — unchanged
- Owner analytics route — kept, now also serves admin
- Owner users route — kept, now also serves admin
- All business logic, models, middleware, utils, socket — untouched
- All other sidebar links — untouched

## Validation

| Check | Result |
|-------|--------|
| Syntax validation (all JS files) | PASS |
| Server startup (0 errors, port 7000) | PASS |
| Public routes (/, /login, /signup) | 200 |
| Auth-protected routes (unauthenticated) | 302 |
| `/admin/analytics` (auth required) | 302 |
| `/admin/users` (auth required) | 302 |
| `/admin/profits` (auth required) | 302 |
| 404 handler | 404 |
| Owner no longer sees Analytics/All Users | Sidebar has no `role === "owner"` block |
| Admin still sees Analytics/All Users/Earnings | Sidebar has `role === "admin"` block with all three |

---

# Earnings Ledger (Permanent Record)

**Date**: 16 July 2026

**Objective**: Transform the Earnings page into a permanent, immutable financial ledger showing only completed & paid projects, with summary cards, filters, statistics, and detailed records.

## What Changed

| Aspect | Before | After |
|--------|--------|-------|
| Query | All projects (unfiltered) | Only `status: "completed"` AND `payment.status: "paid"` |
| Population | `assignedEditor`, `ownerAdmin` | Added `createdBy` for ownership column |
| Sort | `{ createdAt: -1 }` | `{ "payment.paidAt": -1 }` (most recent paid first) |
| Summary Cards | 4 cards (Total Client, Total Editor, Total Profit, Completed & Paid count) | 5 cards (Total Earnings, Projects Paid, Total Client Revenue, Total Editor Payments, Avg Earnings) |
| Filters | None | Search, Date Range (paidAt), Editor dropdown, Sort (newest/oldest/highest earnings/lowest earnings) |
| Table Columns | 8 cols (Project, Client, Editor, Completed, Client Amt, Editor Amt, Profit, Payment) | 11 cols (Project, Client, Owner, JR Admin, Editor, Completed, Paid, Client Amt, Editor Amt, Earnings, View) |
| Statistics | None | Highest Earning project, Lowest Earning project, plus all aggregate values |
| Helper functions | `formatMoney`, `formatStatus`, `getBadgeColor` | Removed `getBadgeColor` (no status badges needed in ledger) |

## Files Modified

| File | Lines | Changes |
|------|-------|---------|
| `routes/admin.js:511-575` | 65 | Filtered query to `{ status: "completed", "payment.status": "paid" }`, added `createdBy` populate, sort by `paidAt desc`, computed full statistics (total, avg, highest, lowest), fetched active editors for filter dropdown |
| `views/admin/profits.ejs` | 180 | Full rewrite: 5 summary cards, filter bar (4 controls + sort), 11-column ledger table, statistics panel, record integrity info box, client-side JS for filtering/sorting |

## Earnings Ledger Rules

- **Only** completed projects with `payment.status === "paid"` appear
- **Earnings** = `clientAmount − editorAmount` (dynamically calculated, never stored)
- **No editing** — records are immutable once payment is marked done
- **No manual entry** — records appear automatically after workflow completion + payment-done action
- **Search** searches across project name, client name, editor name, owner, JR admin
- **Date filter** filters by `paidAt` date
- **Sort** supports newest/oldest by paid date, or highest/lowest earnings

## Validation

| Check | Result |
|-------|--------|
| Syntax validation (all JS files) | PASS |
| Server startup (0 errors, port 7000) | PASS |
| `/` | 200 |
| `/login` | 200 |
| `/admin` (auth redirect) | 302 |
| `/admin/profits` (auth redirect) | 302 |
| `/admin/analytics` (auth redirect) | 302 |
| `/admin/users` (auth redirect) | 302 |
| `/nonexistent` | 404 |

---

# Dashboard 404 Fix — Broken Error Handler Redirect

**Date**: 16 July 2026

**Root Cause**: `server.js:129` — the global 500 error handler redirected admin users to `/admin/dashboard` when no `referer` header was present. **No route at `/admin/dashboard` has ever existed.** The Dashboard has always been served at `/admin` (the root mount of the admin router). This meant any server error without a valid referer would redirect admins to a 404 page, making it appear the Dashboard was broken.

**Trace**:
1. `server.js:109` mounts admin router at `/admin`
2. `routes/admin.js:22` handles `GET /` (Dashboard) — serves at `/admin`
3. `routes/admin.js` has **no** `GET /dashboard` route — never has
4. `sidebar.ejs:3` correctly links Dashboard to `/admin`
5. `server.js:129` erroneously used `"/admin/dashboard"` as fallback on error — **only reference to this path in the entire codebase**

**Fix**: Changed `server.js:129` from `"/admin/dashboard"` to `"/admin"` — matches the actual Dashboard route.

**File Modified** (1):

| File | Line | Change |
|------|------|--------|
| `server.js` | 129 | `"/admin/dashboard"` → `"/admin"` |

**Validation**:

| Check | Result |
|-------|--------|
| Syntax check (`node --check server.js`) | PASS |
| Server startup (0 errors, port 7000) | PASS |
| `/admin` (Dashboard, unauthenticated) | 302 |
| `/admin/workspace` (unauthenticated) | 302 |
| `/admin/profits` (Earnings, unauthenticated) | 302 |
| `/admin/dashboard` (no route, unauthenticated) | 302 (auth redirect, not 404) |
| `/` (public) | 200 |
| `/login` | 200 |
| `/nonexistent` | 404 |

---

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
