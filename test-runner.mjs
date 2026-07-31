import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const mongod = await MongoMemoryServer.create();
const uri = mongod.getUri();

// Set env BEFORE importing the app
process.env.MONGODB_URI = uri;
process.env.PORT = "7890";
process.env.SESSION_SECRET = "test-secret-not-secure";

await mongoose.connect(uri);

const passwordHash = await bcrypt.hash("password123", 10);

const { default: UserModel } = await import("./models/User.js");
const { default: ClientModel } = await import("./models/Client.js");
const { default: ProjectModel } = await import("./models/Project.js");

const User = mongoose.models.User || UserModel;
const Client = mongoose.models.Client || ClientModel;
const Project = mongoose.models.Project || ProjectModel;

const owner = await User.create({ name: "Test Owner", email: "owner@test.com", passwordHash, role: "owner", availability: "available", isActive: true });
const admin = await User.create({ name: "Test Admin", email: "admin@test.com", passwordHash, role: "admin", availability: "available", isActive: true });
const editor = await User.create({ name: "Test Editor", email: "editor@test.com", passwordHash, role: "editor", availability: "available", isActive: true, upiId: "editor@upi" });

const client = await Client.create({ name: "Test Client Inc", notes: "Test client notes", createdBy: owner._id });
const busyEditor = await User.create({ name: "Busy Editor", email: "busy@test.com", passwordHash, role: "editor", availability: "busy", isActive: true });
const leaveEditor = await User.create({ name: "Leave Editor", email: "leave@test.com", passwordHash, role: "editor", availability: "on_leave", isActive: true });
const inactiveEditor = await User.create({ name: "Inactive Editor", email: "inactive@test.com", passwordHash, role: "editor", availability: "available", isActive: false });
await User.create({ name: "Editor3", email: "editor3@test.com", passwordHash, role: "editor", availability: "available", isActive: true });
await User.create({ name: "Editor4", email: "editor4@test.com", passwordHash, role: "editor", availability: "available", isActive: true });
await User.create({ name: "Editor5", email: "editor5@test.com", passwordHash, role: "editor", availability: "available", isActive: true });


const makeTL = (action, user, userName, from, to, notes = "") => ({ action, user, userName, previousStatus: from, newStatus: to, notes });

const pStandard = await Project.create({ client: { name: "Test Client Inc" }, clientRef: client._id, projectName: "Standard Project", driveLink: "https://drive.google.com/standard", priority: "medium", payment: { amount: 5000, clientAmount: 5000 }, createdBy: admin._id, activityTimeline: [makeTL("Project Created", admin._id, "Test Admin", "", "pending_assignment")] });

const pOwnerViaAdmin = await Project.create({ client: { name: "Owner Client" }, projectName: "Owner-Via-Admin Project", driveLink: "https://drive.google.com/owner", priority: "high", ownerAssignment: "admin", ownerAdmin: admin._id, payment: { amount: 10000, clientAmount: 10000, editorAmount: 2000 }, createdBy: owner._id, activityTimeline: [makeTL("Project Created", owner._id, "Test Owner", "", "pending_assignment")] });

const pDirect = await Project.create({ client: { name: "Direct Client" }, projectName: "Direct Assign Project", driveLink: "https://drive.google.com/direct", priority: "urgent", assignedEditor: editor._id, ownerAssignment: "direct", payment: { amount: 8000, clientAmount: 8000, editorAmount: 3000 }, createdBy: owner._id, activityTimeline: [
  makeTL("Project Created", owner._id, "Test Owner", "", "pending_assignment"),
  makeTL("Assigned", owner._id, "Test Owner", "pending_assignment", "assigned")] });

const pOngoing = await Project.create({ client: { name: "Ongoing Client" }, projectName: "Ongoing Project", priority: "medium", status: "ongoing", assignedEditor: editor._id, payment: { amount: 3000, clientAmount: 3000, editorAmount: 1000 }, createdBy: admin._id, activityTimeline: [
  makeTL("Project Created", admin._id, "Test Admin", "", "pending_assignment"),
  makeTL("Assigned", admin._id, "Test Admin", "pending_assignment", "assigned"),
  makeTL("Accepted", editor._id, "Test Editor", "assigned", "ongoing")] });

const pSubmitted = await Project.create({ client: { name: "Submitted Client" }, projectName: "Submitted Project", priority: "high", status: "submitted", assignedEditor: editor._id, submissions: [{ version: 1, driveLink: "https://drive.google.com/sub1", description: "V1", submittedBy: editor._id, submittedAt: new Date() }], payment: { amount: 4000, clientAmount: 4000, editorAmount: 1500 }, createdBy: admin._id, activityTimeline: [
  makeTL("Project Created", admin._id, "Test Admin", "", "pending_assignment"),
  makeTL("Assigned", admin._id, "Test Admin", "pending_assignment", "assigned"),
  makeTL("Accepted", editor._id, "Test Editor", "assigned", "ongoing"),
  makeTL("Submission Uploaded", editor._id, "Test Editor", "ongoing", "submitted")] });

const pCompleted = await Project.create({ client: { name: "Completed Client" }, projectName: "Completed Project", priority: "low", status: "completed", assignedEditor: editor._id, completedAt: new Date(Date.now() - 86400000), submissions: [{ version: 1, driveLink: "https://drive.google.com/comp1", submittedBy: editor._id, submittedAt: new Date(Date.now() - 172800000) }], payment: { amount: 6000, clientAmount: 6000, editorAmount: 2500, status: "pending" }, createdBy: admin._id, activityTimeline: [
  makeTL("Project Created", admin._id, "Test Admin", "", "pending_assignment"),
  makeTL("Assigned", admin._id, "Test Admin", "pending_assignment", "assigned"),
  makeTL("Accepted", editor._id, "Test Editor", "assigned", "ongoing"),
  makeTL("Submission Uploaded", editor._id, "Test Editor", "ongoing", "submitted"),
  makeTL("Completed", admin._id, "Test Admin", "submitted", "completed")] });

const pPaid = await Project.create({ client: { name: "Paid Client" }, projectName: "Paid Project", priority: "medium", status: "completed", assignedEditor: editor._id, completedAt: new Date(Date.now() - 172800000), submissions: [{ version: 1, driveLink: "https://drive.google.com/paid1", submittedBy: editor._id, submittedAt: new Date(Date.now() - 259200000) }], payment: { amount: 7000, clientAmount: 7000, editorAmount: 3000, status: "paid", paidAt: new Date(Date.now() - 86400000), paidBy: admin._id }, createdBy: admin._id, activityTimeline: [
  makeTL("Project Created", admin._id, "Test Admin", "", "pending_assignment"),
  makeTL("Assigned", admin._id, "Test Admin", "pending_assignment", "assigned"),
  makeTL("Accepted", editor._id, "Test Editor", "assigned", "ongoing"),
  makeTL("Submission Uploaded", editor._id, "Test Editor", "ongoing", "submitted"),
  makeTL("Completed", admin._id, "Test Admin", "submitted", "completed"),
  makeTL("Payment Done", admin._id, "Test Admin", "completed", "completed")] });

await mongoose.disconnect();

global.__MONGOD__ = mongod;
global.__SEED_DATA__ = { owner, admin, editor, client, pStandard, pOwnerViaAdmin, pDirect, pOngoing, pSubmitted, pCompleted, pPaid };

console.log("Seed complete. Starting server...");

const { default: connectDb } = await import("./config/db.js");
await connectDb();

const { default: appPromise } = await import("./server.js");
