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

**Objective**: Completion & Payment — Manual payment tracking for completed projects. UPI ID on editor profiles, payment-done button, WhatsApp link, timeline entry, notification, Socket.IO event

**Progress**: Completed

**Completed**: 100%

---

# Latest Iteration Summary

**Date**: 12 July 2026

**Objective**: Implement project completion and manual payment workflow. Payments tracked via dashboard — no gateway integration. Admin pays manually, marks payment done, opens WhatsApp with prefilled message.

**Files Modified**:
- `models/User.js` — Added `upiId` field (string, default "", trim) for editor UPI ID storage
- `routes/workflow.js` — Added `POST /admin/projects/:id/payment-done` (validates completed status + pending payment, sets `payment.status = "paid"`, records `payment.paidAt` + `payment.paidBy`, creates "Payment Done" timeline entry, notification via `createNotification`, Socket.IO broadcast); added `GET /editor/profile` and `POST /editor/profile` (self-service name + UPI ID update); updated admin project show populate to include `upiId`
- `routes/admin.js` — Updated editor create and edit POST handlers to save `upiId` field
- `views/admin/projects/show.ejs` — Added payment section for completed projects: payment details grid (project, client, editor, amount, editor UPI ID, completed date, paid at/by), "Mark Payment Done" button (AJAX with confirmation), "Open WhatsApp" link with prefilled message (`https://wa.me/?text=...`); added payment-done JS handler
- `views/admin/vendors/form.ejs` — Added UPI ID input field to editor create/edit form
- `views/admin/vendors/show.ejs` — Added UPI ID row to editor detail table
- `views/editor/profile.ejs` — New page: simple profile form with name (editable) and UPI ID, email shown as read-only
- `views/partials/editor-nav.ejs` — Added "Profile" nav link
- `public/styles.css` — Added `.payment-section`, `.payment-details`, `.payment-detail`, `.payment-actions`, `#btn-payment-done:disabled` styles

**Completion & Payment Features**:
- ✅ Completed project displays payment section with project name, client, editor, amount, UPI ID, completed date
- ✅ Editor UPI ID visible on completed project page
- ✅ Payment status visible (Pending/Paid badge on payment section header)
- ✅ "Mark Payment Done" button works (AJAX, confirmation dialog)
- ✅ `payment.status` updates to `paid`, records `paidAt` and `paidBy`
- ✅ Already-paid projects show paid details (paid at, paid by) with no further actions
- ✅ Already-paid projects cannot be paid again (validated server-side)
- ✅ Timeline entry "Payment Done" created with amount notes
- ✅ Notification created for editor on payment
- ✅ Socket.IO broadcast emitted on payment
- ✅ WhatsApp opens with prefilled message (`Hi {{Editor}}...`) — admin presses Send manually
- ✅ Editor self-service profile: update name + UPI ID at `/editor/profile`
- ✅ Admin can set/update UPI ID from editor create/edit forms
- ✅ No payment gateway integration (Razorpay, PhonePe, etc.)
- ✅ No QR scanner, no invoices, no accounting

**Test Results**:
- Syntax: all JS files pass `node --check`
- Server startup: 0 errors on port 7000
- Routes verified: `POST /admin/projects/:id/payment-done`, `GET /editor/profile`, `POST /editor/profile` registered
- UPI ID field added to User model and populated in admin project show view
- Regression: existing admin routes, editor routes, workspace, submission/feedback all unchanged

---

# Next Sprint

**UI Polish** — Consistent colors, cards, spacing, responsive design, minimal animations.

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
