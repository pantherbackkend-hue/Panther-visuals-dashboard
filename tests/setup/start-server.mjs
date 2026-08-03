import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const mongod = await MongoMemoryServer.create();
const uri = mongod.getUri();

process.env.MONGODB_URI = uri;
process.env.PORT = "7890";
process.env.SESSION_SECRET = "test-secret-not-secure";

// Connect, seed, disconnect
await mongoose.connect(uri);

const passwordHash = await bcrypt.hash("password123", 10);

const { default: UserModel } = await import("../../models/User.js");
const { default: ClientModel } = await import("../../models/Client.js");
const { default: ProjectModel } = await import("../../models/Project.js");

const User = mongoose.models.User || UserModel;
const Client = mongoose.models.Client || ClientModel;
const Project = mongoose.models.Project || ProjectModel;

const owner = await User.create({ name: "Test Owner", email: "owner@test.com", passwordHash, role: "owner", availability: "available", isActive: true });
const admin = await User.create({ name: "Test Admin", email: "admin@test.com", passwordHash, role: "admin", availability: "available", isActive: true });
const editor = await User.create({ name: "Test Editor", email: "editor@test.com", passwordHash, role: "editor", availability: "available", isActive: true, upiId: "editor@upi" });
await User.create({ name: "Busy Editor", email: "busy@test.com", passwordHash, role: "editor", availability: "busy", isActive: true });
await User.create({ name: "Leave Editor", email: "leave@test.com", passwordHash, role: "editor", availability: "on_leave", isActive: true });
await User.create({ name: "Inactive Editor", email: "inactive@test.com", passwordHash, role: "editor", availability: "available", isActive: false });
await User.create({ name: "Editor Extra 1", email: "e1@test.com", passwordHash, role: "editor", availability: "available", isActive: true });
await User.create({ name: "Editor Extra 2", email: "e2@test.com", passwordHash, role: "editor", availability: "available", isActive: true });
await User.create({ name: "Editor Extra 3", email: "e3@test.com", passwordHash, role: "editor", availability: "available", isActive: true });

const client = await Client.create({ name: "Test Client Inc", notes: "Test client notes", createdBy: owner._id });

const tl = (a, u, un, f, t, n = "") => ({ action: a, user: u._id, userName: un, previousStatus: f, newStatus: t, notes: n });

await Project.create({ client: { name: "Test Client Inc" }, clientRef: client._id, projectName: "Standard Project", assetsFolderLink: "https://drive.google.com/standard", projectFilesLink: "https://drive.google.com/standard-files", priority: "medium", payment: { amount: 5000, clientAmount: 5000 }, createdBy: admin._id, activityTimeline: [tl("Project Created", admin, "Test Admin", "", "pending_assignment")] });

await Project.create({ client: { name: "Owner Client" }, projectName: "Owner-Via-Admin Project", assetsFolderLink: "https://drive.google.com/owner", projectFilesLink: "https://drive.google.com/owner-files", priority: "high", ownerAssignment: "admin", ownerAdmin: admin._id, payment: { amount: 10000, clientAmount: 10000, editorAmount: 2000 }, createdBy: owner._id, activityTimeline: [tl("Project Created", owner, "Test Owner", "", "pending_assignment")] });

await Project.create({ client: { name: "Direct Client" }, projectName: "Direct Assign Project", assetsFolderLink: "https://drive.google.com/direct", projectFilesLink: "https://drive.google.com/direct-files", priority: "urgent", type: "Long", status: "assigned", assignedEditor: editor._id, ownerAssignment: "direct", payment: { amount: 8000, clientAmount: 8000, editorAmount: 3000 }, createdBy: owner._id, activityTimeline: [tl("Project Created", owner, "Test Owner", "", "pending_assignment"), tl("Assigned", owner, "Test Owner", "pending_assignment", "assigned")] });

await Project.create({ client: { name: "Ongoing Client" }, projectName: "Ongoing Project", priority: "medium", status: "ongoing", assignedEditor: editor._id, payment: { amount: 3000, clientAmount: 3000, editorAmount: 1000 }, createdBy: admin._id, activityTimeline: [tl("Project Created", admin, "Test Admin", "", "pending_assignment"), tl("Assigned", admin, "Test Admin", "pending_assignment", "assigned"), tl("Accepted", editor, "Test Editor", "assigned", "ongoing")] });

await Project.create({ client: { name: "Submitted Client" }, projectName: "Submitted Project", priority: "high", status: "submitted", assignedEditor: editor._id, submissions: [{ version: 1, driveLink: "https://drive.google.com/sub1", description: "V1", submittedBy: editor._id, submittedAt: new Date() }], payment: { amount: 4000, clientAmount: 4000, editorAmount: 1500 }, createdBy: admin._id, activityTimeline: [tl("Project Created", admin, "Test Admin", "", "pending_assignment"), tl("Assigned", admin, "Test Admin", "pending_assignment", "assigned"), tl("Accepted", editor, "Test Editor", "assigned", "ongoing"), tl("Submission Uploaded", editor, "Test Editor", "ongoing", "submitted")] });

await Project.create({ client: { name: "Completed Client" }, projectName: "Completed Project", priority: "low", status: "completed", assignedEditor: editor._id, completedAt: new Date(Date.now() - 86400000), submissions: [{ version: 1, driveLink: "https://drive.google.com/comp1", submittedBy: editor._id, submittedAt: new Date(Date.now() - 172800000) }], payment: { amount: 6000, clientAmount: 6000, editorAmount: 2500, status: "pending" }, createdBy: admin._id, activityTimeline: [tl("Project Created", admin, "Test Admin", "", "pending_assignment"), tl("Assigned", admin, "Test Admin", "pending_assignment", "assigned"), tl("Accepted", editor, "Test Editor", "assigned", "ongoing"), tl("Submission Uploaded", editor, "Test Editor", "ongoing", "submitted"), tl("Completed", admin, "Test Admin", "submitted", "completed")] });

await Project.create({ client: { name: "Paid Client" }, projectName: "Paid Project", priority: "medium", type: "Long", status: "completed", assignedEditor: editor._id, completedAt: new Date(Date.now() - 172800000), submissions: [{ version: 1, driveLink: "https://drive.google.com/paid1", submittedBy: editor._id, submittedAt: new Date(Date.now() - 259200000) }], payment: { amount: 7000, clientAmount: 7000, editorAmount: 3000, status: "paid", paidAt: new Date(Date.now() - 86400000), paidBy: admin._id }, createdBy: admin._id, activityTimeline: [tl("Project Created", admin, "Test Admin", "", "pending_assignment"), tl("Assigned", admin, "Test Admin", "pending_assignment", "assigned"), tl("Accepted", editor, "Test Editor", "assigned", "ongoing"), tl("Submission Uploaded", editor, "Test Editor", "ongoing", "submitted"), tl("Completed", admin, "Test Admin", "submitted", "completed"), tl("Payment Done", admin, "Test Admin", "completed", "completed")] });

// Simulate a legacy project that predates the `type` field.
// It must gracefully default to "Short" when loaded/displayed.
await Project.updateOne({ projectName: "Ongoing Project" }, { $unset: { type: 1 } });

await mongoose.disconnect();

// Now start the Express app (it will connect to same URI)
const { default: connectDb } = await import("../../config/db.js");
await connectDb();

const express = (await import("express")).default;
const helmet = (await import("helmet")).default;
const session = (await import("express-session")).default;
const flash = (await import("connect-flash")).default;
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(path.dirname(path.dirname(__filename)));

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

const { renderNotes } = await import("../../utils/renderNotes.js");
app.locals.renderNotes = renderNotes;
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { httpOnly: true } }));
app.use(flash());

const { attachUser } = await import("../../middleware/auth.js");
app.use(attachUser);

app.use(async (req, res, next) => {
  res.locals.currentUser = req.user ? { id: req.user._id, role: req.user.role, name: req.user.name } : null;
  res.locals.flash = { success: req.flash("success"), error: req.flash("error") };
  next();
});

app.get("/", (req, res) => {
  if (req.user) {
    const role = req.user.role;
    if (role === "admin" || role === "owner") return res.redirect("/admin/workspace");
    if (role === "editor") return res.redirect("/editor/projects");
    return res.redirect("/");
  }
  res.render("home", { pageTitle: null });
});

// Mount routes
const { authRouter } = await import("../../routes/auth.js");
const { workflowRouter } = await import("../../routes/workflow.js");
const { adminRouter } = await import("../../routes/admin.js");
const { ownerRouter } = await import("../../routes/owner.js");

app.use(authRouter);
app.use(workflowRouter);
app.use("/admin", adminRouter);
app.use("/admin", ownerRouter);

const server = app.listen(7890, () => {
  console.log("Server running on http://localhost:7890");
});

// Keep alive and handle cleanup
process.on("SIGTERM", async () => {
  await mongod.stop();
  server.close();
  process.exit(0);
});

process.on("SIGINT", async () => {
  await mongod.stop();
  server.close();
  process.exit(0);
});
