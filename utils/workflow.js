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
  completed: [],
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


