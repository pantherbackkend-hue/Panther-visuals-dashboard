import { Notification } from "../models/Notification.js";
import { Project } from "../models/Project.js";
import { getIO } from "../socket/index.js";

export async function createNotification({
  recipient = null,
  recipientRole = null,
  project = null,
  title,
  message = "",
  type = "status_change",
  actionUrl = "",
  channel = "in_app",
}) {
  const notif = await Notification.create({
    recipient,
    recipientRole,
    project,
    title,
    message,
    type,
    actionUrl,
    channel,
  });

  if (channel === "in_app" && getIO()) {
    broadcastNotification(notif);
  }

  return notif;
}

export function broadcastNotification(notification) {
  const io = getIO();
  if (!io) return;

  const payload = {
    _id: notification._id,
    title: notification.title,
    message: notification.message,
    type: notification.type,
    actionUrl: notification.actionUrl,
    read: false,
    createdAt: notification.createdAt,
  };

  if (notification.recipient) {
    io.to(`user:${notification.recipient}`).emit("notification", payload);
  }

  if (notification.recipientRole) {
    io.to(`role:${notification.recipientRole}`).emit("notification", payload);
  }
}

export async function notifyProjectCreated(project, adminUser) {
  return createNotification({
    recipient: adminUser?._id,
    recipientRole: "admin",
    project: project._id,
    title: `Project "${project.projectName}" created`,
    message: `Client: ${project.client?.name || project.clientName}`,
    type: "project_created",
    actionUrl: `/admin/projects/${project._id}`,
  });
}

export async function notifyProjectAssigned(project, editor) {
  return createNotification({
    recipient: editor._id,
    recipientRole: "editor",
    project: project._id,
    title: `New project assigned: "${project.projectName}"`,
    message: `Client: ${project.client?.name || project.clientName} | Priority: ${project.priority}`,
    type: "project_assigned",
    actionUrl: `/editor/projects/${project._id}`,
  });
}

export async function notifyProjectAccepted(project, editor) {
  return createNotification({
    recipientRole: "admin",
    project: project._id,
    title: `Project "${project.projectName}" accepted`,
    message: `Editor ${editor.name} accepted the project`,
    type: "project_accepted",
    actionUrl: `/admin/projects/${project._id}`,
  });
}

export async function notifyFeedbackAdded(project, feedback, adminUser) {
  return createNotification({
    recipientRole: "editor",
    project: project._id,
    title: `Feedback received: "${project.projectName}"`,
    message: feedback.comment ? `V${feedback.versionRef}: ${feedback.comment}` : `Admin provided feedback for version ${feedback.versionRef}`,
    type: "feedback_added",
    actionUrl: `/editor/projects/${project._id}`,
  });
}

export async function notifyStatusChange(project, fromStatus, toStatus, actor) {
  return createNotification({
    recipient: actor?._id,
    recipientRole: actor?.role === "editor" ? "admin" : "editor",
    project: project._id,
    title: `Project "${project.projectName}" updated`,
    message: `Status changed: ${fromStatus} → ${toStatus}`,
    type: "status_change",
    actionUrl: `/${actor?.role === "editor" ? "editor" : "admin"}/projects/${project._id}`,
  });
}

export async function broadcastDashboardUpdate(project) {
  const io = getIO();
  if (!io) return;

  const payload = {
    projectId: project._id,
    projectName: project.projectName,
    status: project.status,
    priority: project.priority,
    updatedAt: new Date(),
  };

  io.to("role:admin").emit("dashboard:update", payload);
  if (project.assignedEditor) {
    io.to(`user:${project.assignedEditor}`).emit("dashboard:update", payload);
  }
}

export async function broadcastProjectCounts(counts) {
  const io = getIO();
  if (!io) return;
  io.to("role:admin").emit("dashboard:counts", counts);
}
