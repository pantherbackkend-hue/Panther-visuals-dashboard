import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const mongod = await MongoMemoryServer.create();
const uri = mongod.getUri();

process.env.MONGODB_URI = uri;
process.env.PORT = "7890";
process.env.SESSION_SECRET = "test-secret-not-secure";

await mongoose.connect(uri);

const passwordHash = await bcrypt.hash("password123", 10);

const { User } = await import("../../models/User.js");
const { Client } = await import("../../models/Client.js");
const { Project } = await import("../../models/Project.js");

const owner = await User.create({ name: "Test Owner", email: "owner@test.com", passwordHash, role: "owner", availability: "available", isActive: true });
const admin = await User.create({ name: "Test Admin", email: "admin@test.com", passwordHash, role: "admin", availability: "available", isActive: true });
const editor = await User.create({ name: "Test Editor", email: "editor@test.com", passwordHash, role: "editor", availability: "available", isActive: true, upiId: "editor@upi" });
await User.create({ name: "Busy Editor", email: "busy@test.com", passwordHash, role: "editor", availability: "busy", isActive: true });
await User.create({ name: "Leave Editor", email: "leave@test.com", passwordHash, role: "editor", availability: "on_leave", isActive: true });
await User.create({ name: "Inactive Editor", email: "inactive@test.com", passwordHash, role: "editor", availability: "available", isActive: false });
await User.create({ name: "Editor EX1", email: "ex1@test.com", passwordHash, role: "editor", availability: "available", isActive: true });
await User.create({ name: "Editor EX2", email: "ex2@test.com", passwordHash, role: "editor", availability: "available", isActive: true });
await User.create({ name: "Editor EX3", email: "ex3@test.com", passwordHash, role: "editor", availability: "available", isActive: true });

const client = await Client.create({ name: "Test Client Inc", notes: "Test client notes", createdBy: owner._id });

const T = (a, u, un, f, t, n = "") => ({ action: a, user: u._id, userName: un, previousStatus: f, newStatus: t, notes: n });

async function makeProject(data) {
  return Project.create(data);
}

await makeProject({ client: { name: "Test Client Inc" }, clientRef: client._id, projectName: "Standard Project", driveLink: "https://drive.google.com/standard", priority: "medium", payment: { amount: 5000, clientAmount: 5000 }, createdBy: admin._id, activityTimeline: [T("Project Created", admin, "Test Admin", "", "pending_assignment")] });
await makeProject({ client: { name: "Owner Client" }, projectName: "Owner-Via-Admin Project", driveLink: "https://drive.google.com/owner", priority: "high", ownerAssignment: "admin", ownerAdmin: admin._id, payment: { amount: 10000, clientAmount: 10000, editorAmount: 2000 }, createdBy: owner._id, activityTimeline: [T("Project Created", owner, "Test Owner", "", "pending_assignment")] });
await makeProject({ client: { name: "Direct Client" }, projectName: "Direct Assign Project", driveLink: "https://drive.google.com/direct", priority: "urgent", assignedEditor: editor._id, ownerAssignment: "direct", payment: { amount: 8000, clientAmount: 8000, editorAmount: 3000 }, createdBy: owner._id, activityTimeline: [T("Project Created", owner, "Test Owner", "", "pending_assignment"), T("Assigned", owner, "Test Owner", "pending_assignment", "assigned")] });
await makeProject({ client: { name: "Ongoing Client" }, projectName: "Ongoing Project", priority: "medium", status: "ongoing", assignedEditor: editor._id, payment: { amount: 3000, clientAmount: 3000, editorAmount: 1000 }, createdBy: admin._id, activityTimeline: [T("Project Created", admin, "Test Admin", "", "pending_assignment"), T("Assigned", admin, "Test Admin", "pending_assignment", "assigned"), T("Accepted", editor, "Test Editor", "assigned", "ongoing")] });
await makeProject({ client: { name: "Submitted Client" }, projectName: "Submitted Project", priority: "high", status: "submitted", assignedEditor: editor._id, submissions: [{ version: 1, driveLink: "https://drive.google.com/sub1", description: "V1", submittedBy: editor._id, submittedAt: new Date() }], payment: { amount: 4000, clientAmount: 4000, editorAmount: 1500 }, createdBy: admin._id, activityTimeline: [T("Project Created", admin, "Test Admin", "", "pending_assignment"), T("Assigned", admin, "Test Admin", "pending_assignment", "assigned"), T("Accepted", editor, "Test Editor", "assigned", "ongoing"), T("Submission Uploaded", editor, "Test Editor", "ongoing", "submitted")] });
await makeProject({ client: { name: "Completed Client" }, projectName: "Completed Project", priority: "low", status: "completed", assignedEditor: editor._id, completedAt: new Date(Date.now() - 86400000), submissions: [{ version: 1, driveLink: "https://drive.google.com/comp1", submittedBy: editor._id, submittedAt: new Date(Date.now() - 172800000) }], payment: { amount: 6000, clientAmount: 6000, editorAmount: 2500, status: "pending" }, createdBy: admin._id, activityTimeline: [T("Project Created", admin, "Test Admin", "", "pending_assignment"), T("Assigned", admin, "Test Admin", "pending_assignment", "assigned"), T("Accepted", editor, "Test Editor", "assigned", "ongoing"), T("Submission Uploaded", editor, "Test Editor", "ongoing", "submitted"), T("Completed", admin, "Test Admin", "submitted", "completed")] });
await makeProject({ client: { name: "Paid Client" }, projectName: "Paid Project", priority: "medium", status: "completed", assignedEditor: editor._id, completedAt: new Date(Date.now() - 172800000), submissions: [{ version: 1, driveLink: "https://drive.google.com/paid1", submittedBy: editor._id, submittedAt: new Date(Date.now() - 259200000) }], payment: { amount: 7000, clientAmount: 7000, editorAmount: 3000, status: "paid", paidAt: new Date(Date.now() - 86400000), paidBy: admin._id }, createdBy: admin._id, activityTimeline: [T("Project Created", admin, "Test Admin", "", "pending_assignment"), T("Assigned", admin, "Test Admin", "pending_assignment", "assigned"), T("Accepted", editor, "Test Editor", "assigned", "ongoing"), T("Submission Uploaded", editor, "Test Editor", "ongoing", "submitted"), T("Completed", admin, "Test Admin", "submitted", "completed"), T("Payment Done", admin, "Test Admin", "completed", "completed")] });

const { Notification } = await import("../../models/Notification.js");

await Notification.create({ recipient: editor._id, recipientRole: "editor", title: "New project assigned", message: "Test notification", type: "project_assigned", actionUrl: "/editor/projects" });

await mongoose.disconnect();

global.__MONGOD__ = mongod;

// Now start the real app — import server.js which will connect to the same URI
await import("../../server.js");
