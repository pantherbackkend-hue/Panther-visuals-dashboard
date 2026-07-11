import express from "express";
import mongoose from "mongoose";
import { Project } from "../models/Project.js";
import { Notification } from "../models/Notification.js";
import { User } from "../models/User.js";
import { requireDb } from "../middleware/requireDb.js";
import { requireAuth, requireAdmin, requireEditor, requireVendorShop } from "../middleware/auth.js";
import {
  isValidStatus,
  canTransition,
  getBadgeColor,
  getAllowedTransitions,
  formatStatus,
  getTimelineAction,
  getNotificationType,
  getDashboardCounts,
  getPriorityWeight,
  updateEditorAvailability,
} from "../utils/workflow.js";
import {
  createNotification,
  notifyProjectCreated,
  notifyProjectAssigned,
  notifyProjectAccepted,
  notifyProjectRejected,
  broadcastDashboardUpdate,
  broadcastProjectCounts,
} from "../utils/notifications.js";
import { getIO } from "../socket/index.js";

export const workflowRouter = express.Router();

function toHexId(value) {
  return value ? String(value) : "";
}

// --- Admin: Create project ---

workflowRouter.get(
  "/admin/projects/new",
  requireDb,
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const editors = await User.find({ role: "editor", isActive: true })
      .sort({ name: 1 })
      .lean();

    res.render("admin/projects/form", {
      pageTitle: "Create Project",
      activeSection: "projects",
      mode: "create",
      project: null,
      editors,
      formatStatus,
    });
  },
);

workflowRouter.post(
  "/admin/projects",
  requireDb,
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const {
        clientName,
        projectName,
        assignedEditor,
        driveLink,
        priority,
        dueDate,
        notes,
        paymentAmount,
      } = req.body;

      if (!clientName || !clientName.trim()) {
        req.flash("error", "Client name is required.");
        return res.redirect("/admin/projects/new");
      }
      if (!projectName || !projectName.trim()) {
        req.flash("error", "Project name is required.");
        return res.redirect("/admin/projects/new");
      }

      if (assignedEditor && !mongoose.isValidObjectId(assignedEditor)) {
        req.flash("error", "Invalid editor selection.");
        return res.redirect("/admin/projects/new");
      }

      if (assignedEditor) {
        const editor = await User.findOne({ _id: assignedEditor, role: "editor" });
        if (!editor) {
          req.flash("error", "Selected editor not found.");
          return res.redirect("/admin/projects/new");
        }
        if (editor.availability === "on_leave") {
          req.flash("error", "Cannot assign project. Editor is on leave.");
          return res.redirect("/admin/projects/new");
        }
        if (editor.availability === "busy") {
          const activeCount = await Project.countDocuments({
            assignedEditor: editor._id,
            status: { $in: ["assigned", "accepted_by_editor", "working", "revision_1", "revision_2", "revision_3"] },
          });
          if (activeCount >= 3) {
            req.flash("error", "Editor is fully occupied. Cannot assign more projects.");
            return res.redirect("/admin/projects/new");
          }
        }
      }

      const status = assignedEditor ? "pending_assignment" : "new_project";

      const project = await Project.create({
        clientName: clientName.trim(),
        projectName: projectName.trim(),
        assignedEditor: assignedEditor || null,
        driveLink: String(driveLink || "").trim(),
        priority: priority || "medium",
        dueDate: dueDate || null,
        notes: String(notes || "").trim(),
        paymentAmount: Number(paymentAmount) || 0,
        status,
        createdBy: req.user._id,
      });

      project.activityTimeline.push({
        action: "Project Created",
        user: req.user._id,
        userName: req.user.name,
        previousStatus: "",
        newStatus: status,
        notes: `Project created by ${req.user.name}`,
      });

      if (assignedEditor) {
        const editor = await User.findById(assignedEditor);

        project.activityTimeline.push({
          action: "Assigned",
          user: req.user._id,
          userName: req.user.name,
          previousStatus: "new_project",
          newStatus: "pending_assignment",
          notes: `Assigned to ${editor.name}`,
        });

        await notifyProjectAssigned(project, editor);
      }

      await project.save();
      await notifyProjectCreated(project, req.user);
      await broadcastDashboardUpdate(project);

      const allProjects = await Project.find().lean();
      const counts = getDashboardCounts(allProjects);
      await broadcastProjectCounts(counts);

      req.flash("success", `Project "${project.projectName}" created.`);
      return res.redirect(`/admin/projects/${project._id}`);
    } catch (err) {
      console.error("Project creation error:", err);
      req.flash("error", err.message || "Failed to create project.");
      return res.redirect("/admin/projects/new");
    }
  },
);

// --- Admin: List all projects ---

workflowRouter.get(
  "/admin/projects",
  requireDb,
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const filter = req.query.filter || "all";
    const search = String(req.query.q || "").trim().toLowerCase();

    const match = {};
    if (filter === "new") match.status = "new_project";
    else if (filter === "unassigned") match.status = "pending_assignment";
    else if (filter === "active") match.status = { $in: ["assigned", "accepted_by_editor", "working"] };
    else if (filter === "revision") match.status = { $in: ["revision_1", "revision_2", "revision_3"] };
    else if (filter === "completed") match.status = "completed";
    else if (filter === "payment") match.status = "waiting_for_payment";
    else if (filter === "paid") match.status = "paid";
    else if (filter === "archived") match.status = "archived";

    const projects = await Project.find(match)
      .populate("assignedEditor", "name email")
      .populate("createdBy", "name")
      .sort({ priority: -1, createdAt: -1 })
      .lean();

    const counts = getDashboardCounts(await Project.find().lean());

    let filtered = projects;
    if (search) {
      filtered = projects.filter((p) => {
        const haystack = [
          p.projectName,
          p.clientName,
          p.assignedEditor?.name,
          toHexId(p._id),
        ].filter(Boolean).join(" ").toLowerCase();
        return haystack.includes(search);
      });
    }

    const formatted = filtered.map((p) => ({
      ...p,
      statusLabel: formatStatus(p.status),
      badgeColor: getBadgeColor(p.status),
    }));

    res.render("admin/projects/index", {
      pageTitle: "Manage Projects",
      activeSection: "projects",
      projects: formatted,
      counts,
      filter,
      search,
      formatStatus,
      formatMoney: (v) => `₹${Number(v || 0).toFixed(2)}`,
    });
  },
);

// --- Admin: View single project ---

workflowRouter.get(
  "/admin/projects/:id",
  requireDb,
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      req.flash("error", "Project not found.");
      return res.redirect("/admin/projects");
    }

    const project = await Project.findById(id)
      .populate("assignedEditor", "name email availability")
      .populate("createdBy", "name")
      .lean();

    if (!project) {
      req.flash("error", "Project not found.");
      return res.redirect("/admin/projects");
    }

    const [editors, projectNotifications] = await Promise.all([
      User.find({ role: "editor", isActive: true }).sort({ name: 1 }).lean(),
      Notification.find({ project: project._id })
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),
    ]);

    const allowedTransitions = getAllowedTransitions(project.status);

    res.render("admin/projects/show", {
      pageTitle: `${project.projectName} - Project Details`,
      activeSection: "projects",
      project,
      editors,
      allowedTransitions,
      projectNotifications,
      formatStatus,
      getBadgeColor,
      formatMoney: (v) => `₹${Number(v || 0).toFixed(2)}`,
    });
  },
);

// --- Admin: Transition project status ---

workflowRouter.post(
  "/admin/projects/:id/transition",
  requireDb,
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const { id } = req.params;
    const { toStatus, notes } = req.body;

    if (!mongoose.isValidObjectId(id)) {
      req.flash("error", "Project not found.");
      return res.redirect("/admin/projects");
    }

    const project = await Project.findById(id);
    if (!project) {
      req.flash("error", "Project not found.");
      return res.redirect("/admin/projects");
    }

    if (!isValidStatus(toStatus)) {
      req.flash("error", `Invalid status: ${toStatus}`);
      return res.redirect(`/admin/projects/${id}`);
    }

    if (!canTransition(project.status, toStatus)) {
      req.flash("error", `Cannot transition from "${formatStatus(project.status)}" to "${formatStatus(toStatus)}".`);
      return res.redirect(`/admin/projects/${id}`);
    }

    if (toStatus === "assigned" && !project.assignedEditor) {
      req.flash("error", "Assign an editor before marking as assigned.");
      return res.redirect(`/admin/projects/${id}`);
    }

    const fromStatus = project.status;
    const action = getTimelineAction(fromStatus, toStatus);

    if (toStatus === "completed" || toStatus === "archived") {
      project.completedAt = new Date();
    }

    if (toStatus.startsWith("revision_")) {
      const revNum = parseInt(toStatus.split("_")[1], 10);
      project.revisionCounter = revNum;
      if (revNum > project.revisionHistory.length) {
        project.revisionHistory.push({
          revisionNumber: revNum,
          requestedBy: req.user._id,
          notes: String(notes || "").trim(),
        });
      }
    }

    if (toStatus === "completed" && fromStatus.startsWith("revision_")) {
      const entry = project.revisionHistory[project.revisionHistory.length - 1];
      if (entry && !entry.completedAt) {
        entry.completedAt = new Date();
      }
    }

    project.status = toStatus;
    project.activityTimeline.push({
      action,
      user: req.user._id,
      userName: req.user.name,
      previousStatus: fromStatus,
      newStatus: toStatus,
      notes: String(notes || "").trim(),
    });

    await project.save();

    if (project.assignedEditor) {
      await updateEditorAvailability(project.assignedEditor, User, Project);
    }

    await broadcastDashboardUpdate(project);

    const allProjects = await Project.find().lean();
    await broadcastProjectCounts(getDashboardCounts(allProjects));

    req.flash("success", `Project moved to "${formatStatus(toStatus)}".`);
    return res.redirect(`/admin/projects/${id}`);
  },
);

// --- Admin: Assign/reassign editor ---

workflowRouter.post(
  "/admin/projects/:id/assign",
  requireDb,
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const { id } = req.params;
    const { editorId } = req.body;

    if (!mongoose.isValidObjectId(id)) {
      req.flash("error", "Project not found.");
      return res.redirect("/admin/projects");
    }

    const project = await Project.findById(id);
    if (!project) {
      req.flash("error", "Project not found.");
      return res.redirect("/admin/projects");
    }

    if (!["new_project", "pending_assignment"].includes(project.status)) {
      req.flash("error", "Editor can only be assigned to unassigned projects.");
      return res.redirect(`/admin/projects/${id}`);
    }

    if (!mongoose.isValidObjectId(editorId)) {
      req.flash("error", "Invalid editor selection.");
      return res.redirect(`/admin/projects/${id}`);
    }

    const editor = await User.findOne({ _id: editorId, role: "editor", isActive: true });
    if (!editor) {
      req.flash("error", "Editor not found or inactive.");
      return res.redirect(`/admin/projects/${id}`);
    }

    if (editor.availability === "on_leave") {
      const notif = await createNotification({
        recipientRole: "admin",
        project: project._id,
        title: `Assignment blocked: "${project.projectName}"`,
        message: `${editor.name} is on leave`,
        type: "assignment_blocked",
        actionUrl: `/admin/projects/${project._id}`,
      });
      req.flash("error", `${editor.name} is on leave. Project remains unassigned.`);
      return res.redirect(`/admin/projects/${id}`);
    }

    if (editor.availability === "busy") {
      const activeCount = await Project.countDocuments({
        assignedEditor: editor._id,
        status: { $in: ["assigned", "accepted_by_editor", "working", "revision_1", "revision_2", "revision_3"] },
      });
      if (activeCount >= 3) {
        req.flash("error", `${editor.name} is fully occupied (${activeCount} active projects). Cannot assign.`);
        return res.redirect(`/admin/projects/${id}`);
      }
    }

    const previousEditorId = project.assignedEditor;
    project.assignedEditor = editor._id;

    const fromStatus = project.status;
    if (fromStatus === "new_project" || fromStatus === "pending_assignment") {
      project.status = "pending_assignment";
    }

    project.activityTimeline.push({
      action: "Assigned",
      user: req.user._id,
      userName: req.user.name,
      previousStatus: fromStatus,
      newStatus: project.status,
      notes: `Assigned to ${editor.name}`,
    });

    await project.save();
    await updateEditorAvailability(editor._id, User, Project);
    await notifyProjectAssigned(project, editor);
    await broadcastDashboardUpdate(project);

    req.flash("success", `Project assigned to ${editor.name}.`);
    return res.redirect(`/admin/projects/${id}`);
  },
);

// --- Admin: Edit project details ---

workflowRouter.get(
  "/admin/projects/:id/edit",
  requireDb,
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      req.flash("error", "Project not found.");
      return res.redirect("/admin/projects");
    }

    const project = await Project.findById(id)
      .populate("assignedEditor", "name email")
      .lean();

    if (!project) {
      req.flash("error", "Project not found.");
      return res.redirect("/admin/projects");
    }

    const editors = await User.find({ role: "editor", isActive: true })
      .sort({ name: 1 })
      .lean();

    res.render("admin/projects/form", {
      pageTitle: `Edit ${project.projectName}`,
      activeSection: "projects",
      mode: "edit",
      project,
      editors,
      formatStatus,
    });
  },
);

workflowRouter.post(
  "/admin/projects/:id/edit",
  requireDb,
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      req.flash("error", "Project not found.");
      return res.redirect("/admin/projects");
    }

    const project = await Project.findById(id);
    if (!project) {
      req.flash("error", "Project not found.");
      return res.redirect("/admin/projects");
    }

    const {
      clientName,
      projectName,
      driveLink,
      priority,
      dueDate,
      notes,
      paymentAmount,
    } = req.body;

    if (!clientName || !clientName.trim()) {
      req.flash("error", "Client name is required.");
      return res.redirect(`/admin/projects/${id}/edit`);
    }
    if (!projectName || !projectName.trim()) {
      req.flash("error", "Project name is required.");
      return res.redirect(`/admin/projects/${id}/edit`);
    }

    project.clientName = clientName.trim();
    project.projectName = projectName.trim();
    project.driveLink = String(driveLink || "").trim();
    project.priority = priority || "medium";
    project.dueDate = dueDate || null;
    project.notes = String(notes || "").trim();
    project.paymentAmount = Number(paymentAmount) || 0;

    project.activityTimeline.push({
      action: "Updated",
      user: req.user._id,
      userName: req.user.name,
      previousStatus: project.status,
      newStatus: project.status,
      notes: "Project details updated",
    });

    await project.save();
    await broadcastDashboardUpdate(project);

    req.flash("success", "Project updated.");
    return res.redirect(`/admin/projects/${id}`);
  },
);

// --- Admin: Delete project ---

workflowRouter.post(
  "/admin/projects/:id/delete",
  requireDb,
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      req.flash("error", "Project not found.");
      return res.redirect("/admin/projects");
    }

    const project = await Project.findById(id);
    if (!project) {
      req.flash("error", "Project not found.");
      return res.redirect("/admin/projects");
    }

    if (project.status !== "archived" && project.status !== "new_project") {
      req.flash("error", "Only archived or new projects can be deleted.");
      return res.redirect(`/admin/projects/${id}`);
    }

    await Project.deleteOne({ _id: id });
    req.flash("success", "Project deleted.");
    return res.redirect("/admin/projects");
  },
);

// --- Editor: View assigned projects ---

workflowRouter.get(
  "/editor/projects",
  requireDb,
  requireAuth,
  requireEditor,
  requireVendorShop,
  async (req, res) => {
    const editorId = req.user._id;

    const projects = await Project.find({ assignedEditor: editorId })
      .sort({ priority: -1, createdAt: -1 })
      .lean();

    const formatted = projects.map((p) => ({
      ...p,
      statusLabel: formatStatus(p.status),
      badgeColor: getBadgeColor(p.status),
    }));

    res.render("editor/projects/index", {
      pageTitle: "My Projects",
      activeSection: "projects",
      projects: formatted,
      formatStatus,
      formatMoney: (v) => `₹${Number(v || 0).toFixed(2)}`,
    });
  },
);

// --- Editor: View single project ---

workflowRouter.get(
  "/editor/projects/:id",
  requireDb,
  requireAuth,
  requireEditor,
  async (req, res) => {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      req.flash("error", "Project not found.");
      return res.redirect("/editor/projects");
    }

    const project = await Project.findById(id)
      .populate("assignedEditor", "name email")
      .lean();

    if (!project || String(project.assignedEditor?._id || project.assignedEditor) !== String(req.user._id)) {
      req.flash("error", "Project not found.");
      return res.redirect("/editor/projects");
    }

    const allowedTransitions = getAllowedTransitions(project.status);

    res.render("editor/projects/show", {
      pageTitle: `${project.projectName} - Project Details`,
      activeSection: "projects",
      project,
      allowedTransitions,
      formatStatus,
      getBadgeColor,
      formatMoney: (v) => `₹${Number(v || 0).toFixed(2)}`,
    });
  },
);

// --- Editor: Transition project status ---

workflowRouter.post(
  "/editor/projects/:id/transition",
  requireDb,
  requireAuth,
  requireEditor,
  async (req, res) => {
    const { id } = req.params;
    const { toStatus, notes } = req.body;

    if (!mongoose.isValidObjectId(id)) {
      req.flash("error", "Project not found.");
      return res.redirect("/editor/projects");
    }

    const project = await Project.findById(id);
    if (!project || String(project.assignedEditor) !== String(req.user._id)) {
      req.flash("error", "Project not found.");
      return res.redirect("/editor/projects");
    }

    if (!isValidStatus(toStatus)) {
      req.flash("error", `Invalid status: ${toStatus}`);
      return res.redirect(`/editor/projects/${id}`);
    }

    if (!canTransition(project.status, toStatus)) {
      req.flash("error", `Cannot transition from "${formatStatus(project.status)}" to "${formatStatus(toStatus)}".`);
      return res.redirect(`/editor/projects/${id}`);
    }

    const editorOnly = ["accepted_by_editor", "working", "pending_assignment"];
    if (toStatus === "pending_assignment" && !editorOnly.includes(toStatus)) {
      req.flash("error", "Editors cannot make this transition.");
      return res.redirect(`/editor/projects/${id}`);
    }

    const fromStatus = project.status;
    const action = getTimelineAction(fromStatus, toStatus);

    project.status = toStatus;

    if (toStatus === "pending_assignment") {
      project.assignedEditor = null;
    }

    project.activityTimeline.push({
      action,
      user: req.user._id,
      userName: req.user.name,
      previousStatus: fromStatus,
      newStatus: toStatus,
      notes: String(notes || "").trim(),
    });

    await project.save();

    if (project.assignedEditor) {
      await updateEditorAvailability(project.assignedEditor, User, Project);
    }

    await broadcastDashboardUpdate(project);

    if (toStatus === "accepted_by_editor") {
      await notifyProjectAccepted(project, req.user);
    } else if (toStatus === "pending_assignment") {
      await notifyProjectRejected(project, req.user);
    }

    req.flash("success", `Project moved to "${formatStatus(toStatus)}".`);
    return res.redirect(`/editor/projects/${id}`);
  },
);

// --- Notifications API ---

workflowRouter.get(
  "/api/notifications",
  requireDb,
  requireAuth,
  async (req, res) => {
    const query = {};

    if (req.user.role === "admin" || req.user.role === "owner") {
      query.$or = [
        { recipient: req.user._id },
        { recipientRole: "admin" },
      ];
    } else if (req.user.role === "editor") {
      query.$or = [
        { recipient: req.user._id },
        { recipientRole: "editor" },
      ];
    } else {
      query.recipient = req.user._id;
    }

    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .limit(50)
      .populate("project", "projectName status")
      .lean();

    res.json({ notifications });
  },
);

workflowRouter.post(
  "/api/notifications/:id/read",
  requireDb,
  requireAuth,
  async (req, res) => {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ error: "Invalid notification id." });
    }

    const notif = await Notification.findById(id);
    if (!notif) {
      return res.status(404).json({ error: "Notification not found." });
    }

    notif.read = true;
    notif.readAt = new Date();
    await notif.save();

    res.json({ success: true });
  },
);

workflowRouter.post(
  "/api/notifications/read-all",
  requireDb,
  requireAuth,
  async (req, res) => {
    const query = {};
    if (req.user.role === "admin" || req.user.role === "owner") {
      query.$or = [
        { recipient: req.user._id },
        { recipientRole: "admin" },
      ];
    } else if (req.user.role === "editor") {
      query.$or = [
        { recipient: req.user._id },
        { recipientRole: "editor" },
      ];
    } else {
      query.recipient = req.user._id;
    }
    query.read = false;

    await Notification.updateMany(query, { read: true, readAt: new Date() });
    res.json({ success: true });
  },
);

// --- Dashboard counts API ---

workflowRouter.get(
  "/api/projects/counts",
  requireDb,
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const allProjects = await Project.find().lean();
    const counts = getDashboardCounts(allProjects);
    res.json(counts);
  },
);

// --- Editor counts API ---

workflowRouter.get(
  "/api/editor/projects/counts",
  requireDb,
  requireAuth,
  requireEditor,
  async (req, res) => {
    const projects = await Project.find({ assignedEditor: req.user._id }).lean();
    const counts = getDashboardCounts(projects);
    res.json(counts);
  },
);

// --- Unread notification count ---

workflowRouter.get(
  "/api/notifications/unread-count",
  requireDb,
  requireAuth,
  async (req, res) => {
    const query = { read: false };
    if (req.user.role === "admin" || req.user.role === "owner") {
      query.$or = [
        { recipient: req.user._id },
        { recipientRole: "admin" },
      ];
    } else if (req.user.role === "editor") {
      query.$or = [
        { recipient: req.user._id },
        { recipientRole: "editor" },
      ];
    } else {
      query.recipient = req.user._id;
    }

    const count = await Notification.countDocuments(query);
    res.json({ count });
  },
);

// --- Global search ---

workflowRouter.get(
  "/api/search",
  requireDb,
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const q = String(req.query.q || "").trim().toLowerCase();
    if (!q || q.length < 2) return res.json({ projects: [], editors: [] });

    const [projects, editors] = await Promise.all([
      Project.find({
        $or: [
          { projectName: { $regex: q, $options: "i" } },
          { clientName: { $regex: q, $options: "i" } },
          { notes: { $regex: q, $options: "i" } },
        ],
      })
        .populate("assignedEditor", "name email")
        .sort({ priority: -1, createdAt: -1 })
        .limit(8)
        .lean(),
      User.find({
        role: "editor",
        $or: [
          { name: { $regex: q, $options: "i" } },
          { email: { $regex: q, $options: "i" } },
        ],
      })
        .select("name email availability")
        .limit(5)
        .lean(),
    ]);

    res.json({
      projects: projects.map((p) => ({
        _id: p._id,
        projectName: p.projectName,
        clientName: p.clientName,
        status: p.status,
        statusLabel: formatStatus(p.status),
        badgeColor: getBadgeColor(p.status),
        editor: p.assignedEditor?.name || "Unassigned",
      })),
      editors: editors.map((e) => ({
        _id: e._id,
        name: e.name,
        email: e.email,
        availability: e.availability,
      })),
    });
  },
);
