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

# Technical Debt

- `Shop` model retains legacy payment gateway fields — unused
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
- All editor functionality should work without a workspace/shop assignment
- Version/submission tracking remains unbounded — version = `submissions.length + 1`
- Keep `STATUS.md` under 500 lines
