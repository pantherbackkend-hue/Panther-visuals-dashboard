const STATUSES = [
  "new_project",
  "pending_assignment",
  "assigned",
  "accepted_by_editor",
  "working",
  "revision_1",
  "revision_2",
  "revision_3",
  "completed",
  "waiting_for_payment",
  "paid",
  "archived",
];

const TRANSITIONS = {
  new_project: ["pending_assignment"],
  pending_assignment: ["assigned", "archived"],
  assigned: ["accepted_by_editor", "pending_assignment"],
  accepted_by_editor: ["working", "pending_assignment"],
  working: ["revision_1", "completed"],
  revision_1: ["revision_2", "completed"],
  revision_2: ["revision_3", "completed"],
  revision_3: ["completed"],
  completed: ["waiting_for_payment", "archived"],
  waiting_for_payment: ["paid"],
  paid: ["archived"],
  archived: [],
};

const BADGE_COLORS = {
  new_project: "muted",
  pending_assignment: "pending",
  assigned: "info",
  accepted_by_editor: "info",
  working: "warning",
  revision_1: "danger",
  revision_2: "danger",
  revision_3: "danger",
  completed: "ok",
  waiting_for_payment: "pending",
  paid: "ok",
  archived: "muted",
};

const DASHBOARD_GROUPS = {
  new_project: "new",
  pending_assignment: "unassigned",
  assigned: "active",
  accepted_by_editor: "active",
  working: "active",
  revision_1: "revision",
  revision_2: "revision",
  revision_3: "revision",
  completed: "completed",
  waiting_for_payment: "payment",
  paid: "paid",
  archived: "archived",
};

const TIMELINE_ACTIONS = {
  new_project: "Project Created",
  pending_assignment: null,
  assigned: "Assigned",
  accepted_by_editor: "Accepted",
  pending_assignment__from_assigned: "Rejected",
  pending_assignment__from_accepted: "Rejected",
  working: "Working",
  revision_1: "Revision Requested",
  revision_2: "Revision Requested",
  revision_3: "Revision Requested",
  revision_1__from_working: "Submitted",
  revision_2__from_revision_1: "Revision Completed",
  revision_3__from_revision_2: "Revision Completed",
  completed__from_working: "Approved",
  completed__from_revision: "Approved",
  waiting_for_payment: "Approved",
  paid: "Paid",
  archived: "Archived",
};

const NOTIFICATION_TYPES = {
  new_project: "project_created",
  assigned: "project_assigned",
  accepted_by_editor: "project_accepted",
  pending_assignment__from_assigned: "project_rejected",
  pending_assignment__from_accepted: "project_rejected",
  working: "working",
  revision_1: "revision_requested",
  revision_2: "revision_requested",
  revision_3: "revision_requested",
  revision_1__from_working: "submitted",
  revision_2__from_revision_1: "revision_completed",
  revision_3__from_revision_2: "revision_completed",
  completed: "approved",
  waiting_for_payment: "approved",
  paid: "paid",
  archived: "archived",
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

export function getNotificationType(fromStatus, toStatus) {
  const key = `${toStatus}__from_${fromStatus}`;
  if (NOTIFICATION_TYPES[key]) return NOTIFICATION_TYPES[key];
  if (NOTIFICATION_TYPES[toStatus]) return NOTIFICATION_TYPES[toStatus];
  return "status_change";
}

export function formatStatus(status) {
  const labels = {
    new_project: "New Project",
    pending_assignment: "Pending Assignment",
    assigned: "Assigned",
    accepted_by_editor: "Accepted by Editor",
    working: "Working",
    revision_1: "Revision 1",
    revision_2: "Revision 2",
    revision_3: "Revision 3",
    completed: "Completed",
    waiting_for_payment: "Waiting for Payment",
    paid: "Paid",
    archived: "Archived",
  };
  return labels[status] || status;
}

export function getDashboardCounts(projects) {
  const counts = {
    new: 0,
    unassigned: 0,
    active: 0,
    revision: 0,
    completed: 0,
    payment: 0,
    paid: 0,
    archived: 0,
    total: projects.length,
  };
  for (const p of projects) {
    const group = getDashboardGroup(p.status);
    if (counts[group] !== undefined) counts[group]++;
  }
  return counts;
}

export function getPriorityWeight(priority) {
  const weights = { low: 0, medium: 1, high: 2, urgent: 3 };
  return weights[priority] || 1;
}

export async function updateEditorAvailability(editorId, UserModel, ProjectModel) {
  if (!editorId || !UserModel || !ProjectModel) return;
  const activeCount = await ProjectModel.countDocuments({
    assignedEditor: editorId,
    status: { $in: ["assigned", "accepted_by_editor", "working", "revision_1", "revision_2", "revision_3"] },
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

export { STATUSES, TRANSITIONS };
