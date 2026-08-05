import { createNotification, broadcastDashboardUpdate } from "./notifications.js";

const STATUSES = [
  "pending_assignment",
  "assigned",
  "ongoing",
  "submitted",
  "completed",
];

const TRANSITIONS = {
  pending_assignment: ["assigned"],
  assigned: ["ongoing", "pending_assignment"],
  ongoing: ["submitted"],
  submitted: ["ongoing", "completed"],
  completed: ["ongoing"],
};

const BADGE_COLORS = {
  pending_assignment: "pending",
  assigned: "info",
  ongoing: "warning",
  submitted: "ok",
  completed: "ok",
};

const DASHBOARD_GROUPS = {
  pending_assignment: "unassigned",
  assigned: "active",
  ongoing: "active",
  submitted: "review",
  completed: "completed",
};

const TIMELINE_ACTIONS = {
  pending_assignment: "Project Created",
  assigned: "Assigned",
  ongoing: "Accepted",
  submitted: "Submission Uploaded",
  ongoing__from_submitted: "Feedback Added",
  ongoing__from_completed: "Reopened",
  completed: "Completed",
};

export function isValidStatus(status) {
  return STATUSES.includes(status);
}

export function getAllowedTransitions(status) {
  return TRANSITIONS[status] || [];
}

export function canTransition(fromStatus, toStatus) {
  const allowed = getAllowedTransitions(fromStatus);
  return allowed.includes(toStatus);
}

export function getBadgeColor(status) {
  return BADGE_COLORS[status] || "muted";
}

export function getDashboardGroup(status) {
  return DASHBOARD_GROUPS[status] || "other";
}

export function getTimelineAction(fromStatus, toStatus) {
  const key = `${toStatus}__from_${fromStatus}`;
  if (TIMELINE_ACTIONS[key]) return TIMELINE_ACTIONS[key];
  if (TIMELINE_ACTIONS[toStatus]) return TIMELINE_ACTIONS[toStatus];
  return "Updated";
}

export function formatStatus(status) {
  const labels = {
    pending_assignment: "Pending Assignment",
    assigned: "Assigned",
    ongoing: "Ongoing",
    submitted: "Submitted",
    completed: "Completed",
  };
  return labels[status] || status;
}

export function getEditorAmount(project) {
  return Number(project?.editorAmount || project?.payment?.editorAmount || 0);
}

export function setEditorAmount(project, amount) {
  const value = Number(amount);
  const safe = isNaN(value) || value < 0 ? 0 : value;
  project.editorAmount = safe;
  if (project.payment) {
    project.payment.editorAmount = safe;
  }
  return safe;
}

export function getDashboardCounts(projects) {
  const counts = {
    new: 0,
    unassigned: 0,
    active: 0,
    review: 0,
    revision: 0,
    completed: 0,
    payment: 0,
    paid: 0,
    total: projects.length,
  };
  for (const p of projects) {
    const group = getDashboardGroup(p.status);
    if (counts[group] !== undefined) counts[group]++;
  }
  return counts;
}

export async function updateEditorAvailability(editorId, UserModel, ProjectModel) {
  if (!editorId || !UserModel || !ProjectModel) return;
  const activeCount = await ProjectModel.countDocuments({
    assignedEditor: editorId,
    status: { $in: ["assigned", "ongoing"] },
  });

  const editor = await UserModel.findById(editorId);
  if (!editor) return;

  if (activeCount >= 3) {
    if (editor.availability !== "on_leave") {
      editor.availability = "busy";
      await editor.save();
    }
  } else {
    if (editor.availability === "busy") {
      editor.availability = "available";
      await editor.save();
    }
  }
}

export async function markProjectPaid(project, user) {
  if (project.status !== "completed") {
    return { ok: false, error: "Only completed projects can receive payment." };
  }
  if (project.payment.status === "paid") {
    return { ok: false, error: "Payment already completed." };
  }

  project.payment.status = "paid";
  project.payment.paidAt = new Date();
  project.payment.paidBy = user._id;

  const paidAmount = project.payment?.editorAmount || project.payment?.amount || 0;
  project.activityTimeline.push({
    action: "Payment Done",
    user: user._id,
    userName: user.name,
    previousStatus: project.status,
    newStatus: project.status,
    notes: `Payment of ₹${paidAmount} marked as paid`,
  });

  await project.save();
  await broadcastDashboardUpdate(project);

  await createNotification({
    recipientRole: "editor",
    project: project._id,
    title: `Payment completed: "${project.projectName}"`,
    message: `Payment of ₹${paidAmount} has been processed.`,
    type: "payment_done",
    actionUrl: `/editor/projects/${project._id}`,
  });

  return { ok: true };
}

export function computeEditorPayments(editors, completedProjects) {
  const rows = editors.map((e) => ({
    editorId: e._id,
    name: e.name,
    upiId: e.upiId || "",
    availability: e.availability,
    isActive: e.isActive,
    completedCount: 0,
    pendingCount: 0,
    pendingAmount: 0,
    pendingProjects: [],
    lastPaidAt: null,
  }));
  const index = new Map(rows.map((r) => [String(r.editorId), r]));

  for (const p of completedProjects) {
    const row = index.get(String(p.assignedEditor?._id || p.assignedEditor));
    if (!row) continue;
    row.completedCount++;
    if (p.payment?.status === "paid") {
      if (p.payment.paidAt && (!row.lastPaidAt || p.payment.paidAt > row.lastPaidAt)) {
        row.lastPaidAt = p.payment.paidAt;
      }
      continue;
    }
    const amount = getEditorAmount(p);
    row.pendingCount++;
    row.pendingAmount += amount;
    row.pendingProjects.push({
      _id: p._id,
      projectName: p.projectName,
      editorAmount: amount,
      clientName: p.clientRef?.name || p.client?.name || "",
      completedAt: p.completedAt || null,
    });
  }

  return rows;
}


