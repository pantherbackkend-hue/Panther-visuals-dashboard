import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { User } from "../../models/User.js";
import { Client } from "../../models/Client.js";
import { Project } from "../../models/Project.js";
import { Notification } from "../../models/Notification.js";
import { Tutorial } from "../../models/Tutorial.js";

export async function seedTestData() {
  const passwordHash = await bcrypt.hash("password123", 10);

  const owner = await User.create({
    name: "Test Owner",
    email: "owner@test.com",
    passwordHash,
    role: "owner",
    availability: "available",
    isActive: true,
  });

  const admin = await User.create({
    name: "Test Admin",
    email: "admin@test.com",
    passwordHash,
    role: "admin",
    availability: "available",
    isActive: true,
  });

  const editor = await User.create({
    name: "Test Editor",
    email: "editor@test.com",
    passwordHash,
    role: "editor",
    availability: "available",
    isActive: true,
    upiId: "editor@upi",
  });

  const clientUser = await User.create({
    name: "Test Client User",
    email: "client@test.com",
    passwordHash,
    role: "client",
    availability: "available",
    isActive: true,
  });

  const client = await Client.create({
    name: "Test Client Inc",
    notes: "Test client notes",
    createdBy: owner._id,
  });

  const standardProject = await Project.create({
    client: { name: "Test Client Inc" },
    clientRef: client._id,
    projectName: "Test Standard Project",
    assetsFolderLink: "https://drive.google.com/test",
    projectFilesLink: "https://drive.google.com/test-files",
    priority: "medium",
    status: "pending_assignment",
    payment: { amount: 5000, clientAmount: 5000, editorAmount: 0 },
    createdBy: admin._id,
    activityTimeline: [{
      action: "Project Created",
      user: admin._id,
      userName: "Test Admin",
      previousStatus: "",
      newStatus: "pending_assignment",
      notes: "Project created by Test Admin",
    }],
  });

  const ownerProjectViaAdmin = await Project.create({
    client: { name: "Owner Client Corp" },
    projectName: "Owner Project via Admin",
    assetsFolderLink: "https://drive.google.com/owner",
    projectFilesLink: "https://drive.google.com/owner-files",
    priority: "high",
    status: "pending_assignment",
    ownerAssignment: "admin",
    ownerAdmin: admin._id,
    payment: { amount: 10000, clientAmount: 10000, editorAmount: 2000 },
    createdBy: owner._id,
    activityTimeline: [{
      action: "Project Created",
      user: owner._id,
      userName: "Test Owner",
      previousStatus: "",
      newStatus: "pending_assignment",
      notes: "Project created by Test Owner",
    }],
  });

  const directAssignProject = await Project.create({
    client: { name: "Direct Client Ltd" },
    projectName: "Direct Assign Project",
    assetsFolderLink: "https://drive.google.com/direct",
    projectFilesLink: "https://drive.google.com/direct-files",
    priority: "urgent",
    type: "Long",
    status: "assigned",
    assignedEditor: editor._id,
    ownerAssignment: "direct",
    payment: { amount: 8000, clientAmount: 8000, editorAmount: 3000 },
    createdBy: owner._id,
    activityTimeline: [
      {
        action: "Project Created",
        user: owner._id,
        userName: "Test Owner",
        previousStatus: "",
        newStatus: "pending_assignment",
        notes: "Project created by Test Owner",
      },
      {
        action: "Assigned",
        user: owner._id,
        userName: "Test Owner",
        previousStatus: "pending_assignment",
        newStatus: "assigned",
        notes: "Assigned directly to Test Editor",
      },
    ],
  });

  const ongoingProject = await Project.create({
    client: { name: "Ongoing Client" },
    projectName: "Ongoing Project",
    assetsFolderLink: "https://drive.google.com/ongoing",
    projectFilesLink: "https://drive.google.com/ongoing-files",
    priority: "medium",
    status: "ongoing",
    assignedEditor: editor._id,
    payment: { amount: 3000, clientAmount: 3000, editorAmount: 1000 },
    createdBy: admin._id,
    activityTimeline: [
      {
        action: "Project Created",
        user: admin._id,
        userName: "Test Admin",
        previousStatus: "",
        newStatus: "pending_assignment",
        notes: "Project created",
      },
      {
        action: "Assigned",
        user: admin._id,
        userName: "Test Admin",
        previousStatus: "pending_assignment",
        newStatus: "assigned",
        notes: "Assigned to Test Editor",
      },
      {
        action: "Accepted",
        user: editor._id,
        userName: "Test Editor",
        previousStatus: "assigned",
        newStatus: "ongoing",
        notes: "Project accepted by editor",
      },
    ],
  });

  const submittedProject = await Project.create({
    client: { name: "Submitted Client" },
    projectName: "Submitted Project",
    assetsFolderLink: "https://drive.google.com/submitted",
    projectFilesLink: "https://drive.google.com/submitted-files",
    priority: "high",
    status: "submitted",
    assignedEditor: editor._id,
    submissions: [{
      version: 1,
      driveLinkPrimary: "https://drive.google.com/submission_v1",
      driveLinkSecondary: "",
      description: "First submission",
      submittedBy: editor._id,
      submittedAt: new Date(),
    }],
    payment: { amount: 4000, clientAmount: 4000, editorAmount: 1500 },
    createdBy: admin._id,
    activityTimeline: [
      {
        action: "Project Created",
        user: admin._id,
        userName: "Test Admin",
        previousStatus: "",
        newStatus: "pending_assignment",
      },
      {
        action: "Assigned",
        user: admin._id,
        userName: "Test Admin",
        previousStatus: "pending_assignment",
        newStatus: "assigned",
      },
      {
        action: "Accepted",
        user: editor._id,
        userName: "Test Editor",
        previousStatus: "assigned",
        newStatus: "ongoing",
      },
      {
        action: "Submission Uploaded",
        user: editor._id,
        userName: "Test Editor",
        previousStatus: "ongoing",
        newStatus: "submitted",
        notes: "Version 1",
      },
    ],
  });

  const completedProject = await Project.create({
    client: { name: "Completed Client" },
    projectName: "Completed Project",
    assetsFolderLink: "https://drive.google.com/completed",
    projectFilesLink: "https://drive.google.com/completed-files",
    priority: "low",
    status: "completed",
    assignedEditor: editor._id,
    completedAt: new Date(),
    submissions: [{
      version: 1,
      driveLinkPrimary: "https://drive.google.com/completed_v1",
      driveLinkSecondary: "",
      description: "Final submission",
      submittedBy: editor._id,
      submittedAt: new Date(Date.now() - 86400000),
    }],
    payment: { amount: 6000, clientAmount: 6000, editorAmount: 2500, status: "pending" },
    createdBy: admin._id,
    activityTimeline: [
      {
        action: "Project Created",
        user: admin._id,
        userName: "Test Admin",
        previousStatus: "",
        newStatus: "pending_assignment",
      },
      {
        action: "Assigned",
        user: admin._id,
        userName: "Test Admin",
        previousStatus: "pending_assignment",
        newStatus: "assigned",
      },
      {
        action: "Accepted",
        user: editor._id,
        userName: "Test Editor",
        previousStatus: "assigned",
        newStatus: "ongoing",
      },
      {
        action: "Submission Uploaded",
        user: editor._id,
        userName: "Test Editor",
        previousStatus: "ongoing",
        newStatus: "submitted",
      },
      {
        action: "Completed",
        user: admin._id,
        userName: "Test Admin",
        previousStatus: "submitted",
        newStatus: "completed",
        notes: "Project completed",
      },
    ],
  });

  const paidProject = await Project.create({
    client: { name: "Paid Client" },
    projectName: "Paid Project",
    assetsFolderLink: "https://drive.google.com/paid",
    projectFilesLink: "https://drive.google.com/paid-files",
    priority: "medium",
    type: "Long",
    status: "completed",
    assignedEditor: editor._id,
    completedAt: new Date(Date.now() - 172800000),
    submissions: [{
      version: 1,
      driveLinkPrimary: "https://drive.google.com/paid_v1",
      driveLinkSecondary: "",
      submittedBy: editor._id,
      submittedAt: new Date(Date.now() - 259200000),
    }],
    payment: {
      amount: 7000, clientAmount: 7000, editorAmount: 3000,
      status: "paid", paidAt: new Date(Date.now() - 86400000),
      paidBy: admin._id,
    },
    createdBy: admin._id,
    activityTimeline: [
      { action: "Project Created", user: admin._id, userName: "Test Admin", previousStatus: "", newStatus: "pending_assignment" },
      { action: "Assigned", user: admin._id, userName: "Test Admin", previousStatus: "pending_assignment", newStatus: "assigned" },
      { action: "Accepted", user: editor._id, userName: "Test Editor", previousStatus: "assigned", newStatus: "ongoing" },
      { action: "Submission Uploaded", user: editor._id, userName: "Test Editor", previousStatus: "ongoing", newStatus: "submitted" },
      { action: "Completed", user: admin._id, userName: "Test Admin", previousStatus: "submitted", newStatus: "completed" },
      { action: "Payment Done", user: admin._id, userName: "Test Admin", previousStatus: "completed", newStatus: "completed", notes: "Payment of ₹3000 marked as paid" },
    ],
  });

  await Notification.create({
    recipient: editor._id,
    recipientRole: "editor",
    project: standardProject._id,
    title: `New project assigned: "${standardProject.projectName}"`,
    message: `Client: Test Client Inc | Priority: medium`,
    type: "project_assigned",
    actionUrl: `/editor/projects/${standardProject._id}`,
  });

  // Simulate a legacy project that predates the `type` field.
  // It must gracefully default to "Short" when loaded/displayed.
  await Project.updateOne({ _id: ongoingProject._id }, { $unset: { type: 1 } });

  const firstTutorial = await Tutorial.create({
    title: "Getting Started with the Dashboard",
    category: "General",
    description: "How to use the dashboard.",
    thumbnailUrl: "",
    videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    displayOrder: 0,
    published: true,
    requiredForOnboarding: true,
    createdBy: admin._id,
  });

  const secondTutorial = await Tutorial.create({
    title: "Advanced Color Grading",
    category: "General",
    description: "How to grade footage.",
    videoUrl: "https://vimeo.com/123456789",
    displayOrder: 1,
    published: true,
    requiredForOnboarding: false,
    createdBy: admin._id,
  });

  return {
    owner, admin, editor, client,
    standardProject, ownerProjectViaAdmin, directAssignProject,
    ongoingProject, submittedProject, completedProject, paidProject,
    firstTutorial, secondTutorial,
  };
}
