# Panther Visuals Dashboard — Agent Rules

MVC-style Node.js application. Before writing any code, read the relevant parts of the existing codebase and reuse it. The best change is the one that adds nothing new.

## Stack

Node.js · Express.js · MongoDB · Mongoose · EJS · Socket.io · Bootstrap · Playwright (tests) · Cloudinary

## Architecture (actual layout)

| Path | Role |
|---|---|
| `server.js` | App bootstrap: middleware wiring, session, socket.io, route mounting |
| `routes/` | Route + handler logic (no `controllers/` directory exists — handlers live in route files: `workflow.js`, `admin.js`, `owner.js`, `auth.js`) |
| `models/` | Mongoose schemas (`User`, `Client`, `Project`, `Notification`) |
| `middleware/` | `auth.js` (`attachUser`, `requireAuth`, `requireEditor`, `requireAdmin`), `requireDb.js` |
| `utils/` | Shared logic: `admin.js`, `workflow.js`, `notifications.js`, `renderNotes.js` |
| `config/` | `db.js`, `cloudinary.js` |
| `views/` | EJS per role: `admin/`, `editor/`, `client/`, `auth/` + `partials/` (`header.ejs`, `footer.ejs`, `editor-nav.ejs`) |
| `public/js/` | Client-side JavaScript |
| `socket/` | Socket.io wiring |
| `scripts/` | One-off migrations |
| `tests/` | Playwright specs (`workflow.spec.mjs`, `client-workflow.spec.mjs`, `notes.spec.mjs`) + unit tests |

Roles: `client`, `editor`, `admin`, `owner` (see `models/User.js` and `middleware/auth.js`). Permission gates must never be weakened.

## Before implementing anything

Inspect these directories first and reference what you found:

- `routes/`
- `models/`
- `middleware/`
- `utils/`
- `config/`
- `views/` and `views/partials/`
- `public/js/`
- `socket/`

## Development rules (before writing code)

1. Search the entire repository.
2. Find every related implementation (routes, handlers, models, middleware, utils, partials, client JS).
3. Explain why existing code cannot be reused.
4. Prefer modifying existing code.
5. Create new files only if absolutely necessary.
6. Reuse middleware.
7. Reuse controllers/handlers.
8. Reuse utilities.
9. Reuse EJS partials.
10. Remove dead code you encounter (no dead imports, no dead branches).

Before creating a helper: explain why an existing helper cannot be extended.
Before creating a model: explain why an existing model cannot be modified.
Before creating a route file: explain why an existing route file cannot be extended.
Before creating a partial: explain why an existing partial cannot be extended.

## Implementation policy (decision order)

Stop at the first rung that holds:

1. Can the feature be implemented without code?
2. Can configuration solve it?
3. Can an existing route solve it?
4. Can an existing handler solve it?
5. Can an existing middleware solve it?
6. Can an existing utility solve it?
7. Can MongoDB do it directly (aggregation, indexes)?
8. Can Mongoose do it directly?
9. Can Express do it directly?
10. Can Bootstrap solve it?
11. Can vanilla JavaScript solve it?
12. Only then write new code.

## Quality gates

Every implementation must satisfy:

- no duplicate queries
- no duplicated business logic
- no dead imports
- no dead code
- role permissions remain intact (`editor`/`client`/`admin`/`owner` gates verified)
- maintain the existing MVC-style structure
- consistent naming with the surrounding code
- reusable implementation (no copy-paste forks of existing helpers)

Business logic stays centralized in `utils/` and models — route handlers stay thin.

## Known failure: schema enums silently break "button does nothing"

**Symptom:** A UI action (transition/notification/status) clicks but the page reports failure, appears to do nothing, or persists then errors — with no obvious route bug.

**Root cause (hit twice, `Reopened` timeline + `reopened` notification):** Mongoose `enum` validated arrays are in **two** models and reject new string values:

- `models/Project.js` — `activityTimeline[].action` enum (e.g. `"Reopened"`, `"Submission Updated"`). A new `getTimelineAction(fromStatus, toStatus)` return value that isn't in the enum makes `project.save()` throw `ValidationError` **after** the status field is already mutated → flash error + follow-through lost.
- `models/Notification.js` — `type` enum (e.g. `"reopened"`, `"submitted_updated"`). `createNotification` throws and can abort the whole handler even when the core save succeeded.

**Diagnosis checklist (order):**
1. Reproduce the click and watch the browser Network tab for a `500` on the transition/notification POST.
2. Read the server log for `ValidationError ... not a valid enum value for path`. It names the model and field directly.
3. Grep the model file for the `enum:` array — add the missing value.
4. Cross-check every new string you wrote during the feature against **both** `Project` and `Notification` enums before shipping.
5. Verify end-to-end with a Playwright spec that clicks the real button and asserts the persisted state + both relevant portals (admin/owner + editor).

Example fix: reach for the enum arrays in `models/Project.js` and `models/Notification.js` any time a feature adds a new status, transition, or notification `type`.
