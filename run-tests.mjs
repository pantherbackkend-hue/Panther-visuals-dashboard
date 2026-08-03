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

const { default: UserModel } = await import("./models/User.js");
const { default: ClientModel } = await import("./models/Client.js");
const { default: ProjectModel } = await import("./models/Project.js");
const { default: NotificationModel } = await import("./models/Notification.js");

const User = mongoose.models.User || UserModel;
const Client = mongoose.models.Client || ClientModel;
const Project = mongoose.models.Project || ProjectModel;
const Notification = mongoose.models.Notification || NotificationModel;

const owner = await User.create({ name: "Test Owner", email: "owner@test.com", passwordHash, role: "owner", availability: "available", isActive: true });
const admin = await User.create({ name: "Test Admin", email: "admin@test.com", passwordHash, role: "admin", availability: "available", isActive: true });
const editor = await User.create({ name: "Test Editor", email: "editor@test.com", passwordHash, role: "editor", availability: "available", isActive: true, upiId: "editor@upi" });

const client = await Client.create({ name: "Test Client Inc", notes: "Test client notes", createdBy: owner._id });
const busyEditor = await User.create({ name: "Busy Editor", email: "busy@test.com", passwordHash, role: "editor", availability: "busy", isActive: true });
const leaveEditor = await User.create({ name: "Leave Editor", email: "leave@test.com", passwordHash, role: "editor", availability: "on_leave", isActive: true });
const inactiveEditor = await User.create({ name: "Inactive Editor", email: "inactive@test.com", passwordHash, role: "editor", availability: "available", isActive: false });


const p1 = await Project.create({ client: { name: "Test Client Inc" }, clientRef: client._id, projectName: "Standard Project", assetsFolderLink: "https://drive.google.com/standard", projectFilesLink: "https://drive.google.com/standard-files", priority: "medium", payment: { amount: 5000, clientAmount: 5000 }, createdBy: admin._id, activityTimeline: [{ action: "Project Created", user: admin._id, userName: "Test Admin", previousStatus: "", newStatus: "pending_assignment", notes: "Project created" }] });

const p2 = await Project.create({ client: { name: "Owner Client" }, projectName: "Owner-Via-Admin Project", assetsFolderLink: "https://drive.google.com/owner", projectFilesLink: "https://drive.google.com/owner-files", priority: "high", ownerAssignment: "admin", ownerAdmin: admin._id, payment: { amount: 10000, clientAmount: 10000, editorAmount: 2000 }, createdBy: owner._id, activityTimeline: [{ action: "Project Created", user: owner._id, userName: "Test Owner", previousStatus: "", newStatus: "pending_assignment", notes: "Created" }] });

const p3 = await Project.create({ client: { name: "Direct Client" }, projectName: "Direct Assign Project", assetsFolderLink: "https://drive.google.com/direct", projectFilesLink: "https://drive.google.com/direct-files", priority: "urgent", assignedEditor: editor._id, ownerAssignment: "direct", payment: { amount: 8000, clientAmount: 8000, editorAmount: 3000 }, createdBy: owner._id, activityTimeline: [
  { action: "Project Created", user: owner._id, userName: "Test Owner", previousStatus: "", newStatus: "pending_assignment" },
  { action: "Assigned", user: owner._id, userName: "Test Owner", previousStatus: "pending_assignment", newStatus: "assigned", notes: "Direct to editor" }] });

const p4 = await Project.create({ client: { name: "Ongoing Client" }, projectName: "Ongoing Project", priority: "medium", status: "ongoing", assignedEditor: editor._id, payment: { amount: 3000, clientAmount: 3000, editorAmount: 1000 }, createdBy: admin._id, activityTimeline: [
  { action: "Project Created", user: admin._id, userName: "Test Admin", previousStatus: "", newStatus: "pending_assignment" },
  { action: "Assigned", user: admin._id, userName: "Test Admin", previousStatus: "pending_assignment", newStatus: "assigned" },
  { action: "Accepted", user: editor._id, userName: "Test Editor", previousStatus: "assigned", newStatus: "ongoing", notes: "Accepted" }] });

const p5 = await Project.create({ client: { name: "Submitted Client" }, projectName: "Submitted Project", priority: "high", status: "submitted", assignedEditor: editor._id, submissions: [{ version: 1, driveLink: "https://drive.google.com/sub1", description: "V1", submittedBy: editor._id, submittedAt: new Date() }], payment: { amount: 4000, clientAmount: 4000, editorAmount: 1500 }, createdBy: admin._id, activityTimeline: [
  { action: "Project Created", user: admin._id, userName: "Test Admin", previousStatus: "", newStatus: "pending_assignment" },
  { action: "Assigned", user: admin._id, userName: "Test Admin", previousStatus: "pending_assignment", newStatus: "assigned" },
  { action: "Accepted", user: editor._id, userName: "Test Editor", previousStatus: "assigned", newStatus: "ongoing" },
  { action: "Submission Uploaded", user: editor._id, userName: "Test Editor", previousStatus: "ongoing", newStatus: "submitted", notes: "Version 1" }] });

const p6 = await Project.create({ client: { name: "Completed Client" }, projectName: "Completed Project", priority: "low", status: "completed", assignedEditor: editor._id, completedAt: new Date(Date.now() - 86400000), submissions: [{ version: 1, driveLink: "https://drive.google.com/comp1", submittedBy: editor._id, submittedAt: new Date(Date.now() - 172800000) }], payment: { amount: 6000, clientAmount: 6000, editorAmount: 2500, status: "pending" }, createdBy: admin._id, activityTimeline: [
  { action: "Project Created", user: admin._id, userName: "Test Admin", previousStatus: "", newStatus: "pending_assignment" },
  { action: "Assigned", user: admin._id, userName: "Test Admin", previousStatus: "pending_assignment", newStatus: "assigned" },
  { action: "Accepted", user: editor._id, userName: "Test Editor", previousStatus: "assigned", newStatus: "ongoing" },
  { action: "Submission Uploaded", user: editor._id, userName: "Test Editor", previousStatus: "ongoing", newStatus: "submitted" },
  { action: "Completed", user: admin._id, userName: "Test Admin", previousStatus: "submitted", newStatus: "completed", notes: "Completed" }] });

const p7 = await Project.create({ client: { name: "Paid Client" }, projectName: "Paid Project", priority: "medium", status: "completed", assignedEditor: editor._id, completedAt: new Date(Date.now() - 172800000), submissions: [{ version: 1, driveLink: "https://drive.google.com/paid1", submittedBy: editor._id, submittedAt: new Date(Date.now() - 259200000) }], payment: { amount: 7000, clientAmount: 7000, editorAmount: 3000, status: "paid", paidAt: new Date(Date.now() - 86400000), paidBy: admin._id }, createdBy: admin._id, activityTimeline: [
  { action: "Project Created", user: admin._id, userName: "Test Admin", previousStatus: "", newStatus: "pending_assignment" },
  { action: "Assigned", user: admin._id, userName: "Test Admin", previousStatus: "pending_assignment", newStatus: "assigned" },
  { action: "Accepted", user: editor._id, userName: "Test Editor", previousStatus: "assigned", newStatus: "ongoing" },
  { action: "Submission Uploaded", user: editor._id, userName: "Test Editor", previousStatus: "ongoing", newStatus: "submitted" },
  { action: "Completed", user: admin._id, userName: "Test Admin", previousStatus: "submitted", newStatus: "completed" },
  { action: "Payment Done", user: admin._id, userName: "Test Admin", previousStatus: "completed", newStatus: "completed", notes: "Payment of Rs3000 marked as paid" }] });

await mongoose.disconnect();

await import("./server.js");

console.log("Server started on http://localhost:7890");
