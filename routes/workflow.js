import express from "express";
import mongoose from "mongoose";
import { Project } from "../models/Project.js";
import { Notification } from "../models/Notification.js";
import { User } from "../models/User.js";
import { requireDb } from "../middleware/requireDb.js";
import { requireAuth, requireAdmin, requireEditor } from "../middleware/auth.js";
import {
  isValidStatus,
  canTransition,
  getBadgeColor,
  getAllowedTransitions,
  formatStatus,
  getTimelineAction,
  getDashboardCounts,
  updateEditorAvailability,
} from "../utils/workflow.js";
import {
  createNotification,
  notifyProjectCreated,
  notifyProjectAssigned,
  notifyProjectAccepted,
  notifyFeedbackAdded,
  broadcastDashboardUpdate,
  broadcastProjectCounts,
} from "../utils/notifications.js";
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

    const admins = req.user.role === "owner"
      ? await User.find({ role: "admin", isActive: true }).sort({ name: 1 }).lean()
      : [];

    res.render("admin/projects/form", {
      pageTitle: "Create Project",
      activeSection: "projects",
      mode: "create",
      project: null,
      editors,
      admins,
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
        clientEmail,
        clientPhone,
        projectName,
        assignedEditor,
        driveLink,
        priority,
        dueDate,
        notes,
        paymentAmount,
        ownerAssignment,
        ownerAdmin,
        clientAmount,
        editorAmount,
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
            status: { $in: ["assigned", "ongoing"] },
          });
          if (activeCount >= 3) {
            req.flash("error", "Editor is fully occupied. Cannot assign more projects.");
            return res.redirect("/admin/projects/new");
          }
        }
      }

      const ca = Number(clientAmount || paymentAmount) || 0;
      const ea = Number(editorAmount) || 0;
      const paymentData = { amount: ca, clientAmount: ca, editorAmount: ea };

      if (req.user.role === "owner") {
        paymentData.clientAmount = ca;
        paymentData.editorAmount = ea;
      }

      const isOwnerAssignAdmin = ownerAssignment === "admin";
      const isOwnerAssignDirect = ownerAssignment === "direct";

      const project = await Project.create({
        client: {
          name: clientName.trim(),
          email: String(clientEmail || "").trim(),
          phone: String(clientPhone || "").trim(),
        },
        projectName: projectName.trim(),
        assignedEditor: isOwnerAssignDirect && assignedEditor ? assignedEditor : (assignedEditor || null),
        driveLink: String(driveLink || "").trim(),
        priority: priority || "medium",
        dueDate: dueDate || null,
        notes: String(notes || "").trim(),
        payment: paymentData,
        status: isOwnerAssignDirect && assignedEditor ? "assigned" : "pending_assignment",
        ownerAssignment: req.user.role === "owner" ? (ownerAssignment || null) : null,
        ownerAdmin: isOwnerAssignAdmin && ownerAdmin ? ownerAdmin : null,
        createdBy: req.user._id,
      });

      project.activityTimeline.push({
        action: "Project Created",
        user: req.user._id,
        userName: req.user.name,
        previousStatus: "",
        newStatus: "pending_assignment",
        notes: `Project created by ${req.user.name}`,
      });

      if (assignedEditor && !isOwnerAssignAdmin) {
        const editor = await User.findById(assignedEditor);
        if (editor) {
          project.assignedEditor = editor._id;
          project.status = "assigned";
          const assignNote = isOwnerAssignDirect
            ? `Assigned directly to ${editor.name}`
            : `Assigned to ${editor.name}`;
          project.activityTimeline.push({
            action: "Assigned",
            user: req.user._id,
            userName: req.user.name,
            previousStatus: "pending_assignment",
            newStatus: "assigned",
            notes: assignNote,
          });
          await notifyProjectAssigned(project, editor);
        }
      }

      if (isOwnerAssignAdmin && ownerAdmin) {
        const admin = await User.findById(ownerAdmin);
        if (admin) {
          project.activityTimeline.push({
            action: "Project Created",
            user: req.user._id,
            userName: req.user.name,
            previousStatus: "",
            newStatus: "pending_assignment",
            notes: `Assigned to JR Admin ${admin.name} for editor assignment`,
          });
        }
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
    if (filter === "unassigned") match.status = "pending_assignment";
    else if (filter === "active") match.status = { $in: ["assigned", "ongoing"] };
    else if (filter === "review") match.status = "submitted";
    else if (filter === "completed") match.status = "completed";

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
      clientName: p.client?.name || p.clientName || "",
      paymentAmount: p.payment?.amount || 0,
      statusLabel: formatStatus(p.status),
      badgeColor: getBadgeColor(p.status),
      ownerAssignmentLabel: p.ownerAssignment === "admin" ? "Via JR Admin" : p.ownerAssignment === "direct" ? "Direct to Editor" : null,
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
      .populate("assignedEditor", "name email availability upiId")
      .populate("createdBy", "name")
      .lean();

    if (!project) {
      req.flash("error", "Project not found.");
      return res.redirect("/admin/projects");
    }

    const [editors, projectNotifications, admins] = await Promise.all([
      User.find({ role: "editor", isActive: true }).sort({ name: 1 }).lean(),
      Notification.find({ project: project._id })
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),
      req.user.role === "owner"
        ? User.find({ role: "admin", isActive: true }).sort({ name: 1 }).lean()
        : Promise.resolve([]),
    ]);

    const allowedTransitions = getAllowedTransitions(project.status);

    const clientAmount = project.payment?.clientAmount || project.payment?.amount || 0;
    const editorAmount = project.payment?.editorAmount || 0;
    const profit = clientAmount - editorAmount;

    res.render("admin/projects/show", {
      pageTitle: `${project.projectName} - Project Details`,
      activeSection: "projects",
      project,
      editors,
      admins,
      allowedTransitions,
      projectNotifications,
      profit,
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
    try {
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

      if (toStatus === "completed") {
        project.completedAt = new Date();
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
    } catch (err) {
      console.error("Transition error:", err);
      req.flash("error", "Something went wrong. Please try again.");
      return res.redirect(`/admin/projects/${id}`);
    }
  },
);

// --- Admin: Assign/reassign editor ---

workflowRouter.post(
  "/admin/projects/:id/assign",
  requireDb,
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
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

      if (project.status !== "pending_assignment") {
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
          status: { $in: ["assigned", "ongoing"] },
        });
        if (activeCount >= 3) {
          req.flash("error", `${editor.name} is fully occupied (${activeCount} active projects). Cannot assign.`);
          return res.redirect(`/admin/projects/${id}`);
        }
      }

      const previousEditorId = project.assignedEditor;
      const fromStatus = project.status;
      project.assignedEditor = editor._id;
      project.status = "assigned";

      project.activityTimeline.push({
        action: "Assigned",
        user: req.user._id,
        userName: req.user.name,
        previousStatus: fromStatus,
        newStatus: "assigned",
        notes: `Assigned to ${editor.name}`,
      });

      await project.save();
      await updateEditorAvailability(editor._id, User, Project);
      await notifyProjectAssigned(project, editor);
      await broadcastDashboardUpdate(project);

      req.flash("success", `Project assigned to ${editor.name}.`);
      return res.redirect(`/admin/projects/${id}`);
    } catch (err) {
      console.error("Assign error:", err);
      req.flash("error", "Something went wrong. Please try again.");
      return res.redirect(`/admin/projects/${id}`);
    }
  },
);

// --- Admin: Send feedback (submitted → ongoing) ---

workflowRouter.post(
  "/admin/projects/:id/feedback",
  requireDb,
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;
      if (!mongoose.isValidObjectId(id)) {
        return res.status(400).json({ error: "Invalid project id." });
      }

      const project = await Project.findById(id);
      if (!project) {
        return res.status(404).json({ error: "Project not found." });
      }

      if (project.status !== "submitted") {
        return res.status(400).json({ error: "Only submitted projects can receive feedback." });
      }

      const { comment, driveLink, timestamp } = req.body;
      const latestSubmission = project.submissions?.length > 0
        ? project.submissions[project.submissions.length - 1]
        : null;

      const feedbackEntry = {
        versionRef: latestSubmission ? latestSubmission.version : null,
        comment: String(comment || "").trim(),
        driveLink: String(driveLink || "").trim(),
        timestamp: String(timestamp || "").trim(),
        createdBy: req.user._id,
        createdAt: new Date(),
      };

      project.feedback.push(feedbackEntry);

      const fromStatus = project.status;
      project.status = "ongoing";
      project.activityTimeline.push({
        action: "Feedback Added",
        user: req.user._id,
        userName: req.user.name,
        previousStatus: fromStatus,
        newStatus: "ongoing",
        notes: comment ? `V${feedbackEntry.versionRef}: ${comment}` : `Feedback provided for version ${feedbackEntry.versionRef}`,
      });

      await project.save();
      await broadcastDashboardUpdate(project);
      await notifyFeedbackAdded(project, feedbackEntry, req.user);

      res.json({ success: true });
    } catch (err) {
      console.error("Feedback error:", err);
      res.status(500).json({ error: err.message || "Failed to send feedback." });
    }
  },
);

// --- Admin: Complete project (submitted → completed) ---

workflowRouter.post(
  "/admin/projects/:id/complete",
  requireDb,
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;
      if (!mongoose.isValidObjectId(id)) {
        return res.status(400).json({ error: "Invalid project id." });
      }

      const project = await Project.findById(id);
      if (!project) {
        return res.status(404).json({ error: "Project not found." });
      }

      if (project.status !== "submitted") {
        return res.status(400).json({ error: "Only submitted projects can be completed." });
      }

      const fromStatus = project.status;
      project.status = "completed";
      project.completedAt = new Date();

      project.activityTimeline.push({
        action: "Completed",
        user: req.user._id,
        userName: req.user.name,
        previousStatus: fromStatus,
        newStatus: "completed",
        notes: "Project completed",
      });

      await project.save();

      if (project.assignedEditor) {
        await updateEditorAvailability(project.assignedEditor, User, Project);
      }

      await broadcastDashboardUpdate(project);

      await createNotification({
        recipientRole: "editor",
        project: project._id,
        title: `Project completed: "${project.projectName}"`,
        message: "Your project has been marked as complete.",
        type: "completed",
        actionUrl: `/editor/projects/${project._id}`,
      });

      res.json({ success: true, projectId: project._id });
    } catch (err) {
      console.error("Complete error:", err);
      res.status(500).json({ error: err.message || "Failed to complete project." });
    }
  },
);

// --- Admin: Mark payment done (completed projects only) ---

workflowRouter.post(
  "/admin/projects/:id/payment-done",
  requireDb,
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;
      if (!mongoose.isValidObjectId(id)) {
        return res.status(400).json({ error: "Invalid project id." });
      }

      const project = await Project.findById(id);
      if (!project) {
        return res.status(404).json({ error: "Project not found." });
      }

      if (project.status !== "completed") {
        return res.status(400).json({ error: "Only completed projects can receive payment." });
      }

      if (project.payment.status === "paid") {
        return res.status(400).json({ error: "Payment already completed." });
      }

      project.payment.status = "paid";
      project.payment.paidAt = new Date();
      project.payment.paidBy = req.user._id;

      const paidAmount = project.payment?.editorAmount || project.payment?.amount || 0;
      project.activityTimeline.push({
        action: "Payment Done",
        user: req.user._id,
        userName: req.user.name,
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

      res.json({ success: true });
    } catch (err) {
      console.error("Payment done error:", err);
      res.status(500).json({ error: err.message || "Failed to mark payment as done." });
    }
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

    const admins = req.user.role === "owner"
      ? await User.find({ role: "admin", isActive: true }).sort({ name: 1 }).lean()
      : [];

    res.render("admin/projects/form", {
      pageTitle: `Edit ${project.projectName}`,
      activeSection: "projects",
      mode: "edit",
      project,
      editors,
      admins,
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
      clientEmail,
      clientPhone,
      projectName,
      driveLink,
      priority,
      dueDate,
      notes,
      paymentAmount,
      clientAmount,
      editorAmount,
    } = req.body;

    const isOwnerProject = project.ownerAssignment && req.user.role !== "owner";

    if (!isOwnerProject) {
      if (!clientName || !clientName.trim()) {
        req.flash("error", "Client name is required.");
        return res.redirect(`/admin/projects/${id}/edit`);
      }
      if (!projectName || !projectName.trim()) {
        req.flash("error", "Project name is required.");
        return res.redirect(`/admin/projects/${id}/edit`);
      }
    }

    if (req.user.role === "owner" || !project.ownerAssignment) {
      project.client = {
        name: String(clientName || project.client?.name || "").trim(),
        email: String(clientEmail || project.client?.email || "").trim(),
        phone: String(clientPhone || project.client?.phone || "").trim(),
      };
      project.projectName = String(projectName || project.projectName || "").trim();
      project.driveLink = String(driveLink || project.driveLink || "").trim();
      project.priority = priority || project.priority || "medium";
      project.dueDate = dueDate || project.dueDate || null;
      project.notes = String(notes || project.notes || "").trim();
    }

    if (req.user.role === "owner") {
      const ca = Number(clientAmount);
      const ea = Number(editorAmount);
      project.payment.clientAmount = isNaN(ca) ? (project.payment.clientAmount || 0) : ca;
      project.payment.editorAmount = isNaN(ea) ? (project.payment.editorAmount || 0) : ea;
      project.payment.amount = project.payment.clientAmount;
    } else if (project.ownerAssignment) {
      const ea = Number(editorAmount);
      project.payment.editorAmount = isNaN(ea) ? (project.payment.editorAmount || 0) : ea;
    } else {
      const pa = Number(paymentAmount);
      project.payment.amount = isNaN(pa) ? 0 : pa;
      project.payment.clientAmount = project.payment.amount;
    }

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
    try {
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

      if (project.status !== "pending_assignment") {
        req.flash("error", "Only unassigned projects can be deleted.");
        return res.redirect(`/admin/projects/${id}`);
      }

      await Project.deleteOne({ _id: id });
      req.flash("success", "Project deleted.");
      return res.redirect("/admin/projects");
    } catch (err) {
      console.error("Delete error:", err);
      req.flash("error", "Something went wrong. Please try again.");
      return res.redirect("/admin/projects");
    }
  },
);

// --- Editor: View assigned projects ---

workflowRouter.get(
  "/editor/projects",
  requireDb,
  requireAuth,
  requireEditor,
  async (req, res) => {
    const editorId = req.user._id;

    const projects = await Project.find({ assignedEditor: editorId })
      .sort({ priority: -1, createdAt: -1 })
      .lean();

    const formatted = projects.map((p) => ({
      ...p,
      clientName: p.client?.name || p.clientName || "",
      paymentAmount: p.payment?.amount || 0,
      statusLabel: formatStatus(p.status),
      badgeColor: getBadgeColor(p.status),
    }));

    const assignedProjects = formatted.filter((p) => p.status === "assigned");
    const ongoingProjects = formatted.filter((p) => p.status === "ongoing" || p.status === "submitted");
    const completedProjects = formatted.filter((p) => p.status === "completed");

    res.render("editor/projects/index", {
      pageTitle: "My Projects",
      activeSection: "projects",
      currentTab: req.query.tab || "assigned",
      assigned: assignedProjects,
      ongoing: ongoingProjects,
      completed: completedProjects,
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
      .populate("feedback.createdBy", "name")
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
    try {
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

      const editorOnly = ["ongoing", "submitted"];
      if (!editorOnly.includes(toStatus)) {
        req.flash("error", "Editors cannot make this transition.");
        return res.redirect(`/editor/projects/${id}`);
      }

      const fromStatus = project.status;
      const action = getTimelineAction(fromStatus, toStatus);

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

      if (toStatus === "ongoing") {
        await notifyProjectAccepted(project, req.user);
      }

      req.flash("success", `Project moved to "${formatStatus(toStatus)}".`);
      return res.redirect(`/editor/projects/${id}`);
    } catch (err) {
      console.error("Editor transition error:", err);
      req.flash("error", "Something went wrong. Please try again.");
      return res.redirect(`/editor/projects/${id}`);
    }
  },
);

// --- Editor: Accept project (assigned → ongoing) ---

workflowRouter.post(
  "/editor/projects/:id/accept",
  requireDb,
  requireAuth,
  requireEditor,
  async (req, res) => {
    try {
      const { id } = req.params;
      if (!mongoose.isValidObjectId(id)) {
        return res.status(400).json({ error: "Invalid project id." });
      }

      const project = await Project.findById(id);
      if (!project || String(project.assignedEditor) !== String(req.user._id)) {
        return res.status(404).json({ error: "Project not found." });
      }

      if (project.status !== "assigned") {
        return res.status(400).json({ error: "Project is not in assignable status." });
      }

      project.status = "ongoing";
      project.activityTimeline.push({
        action: "Accepted",
        user: req.user._id,
        userName: req.user.name,
        previousStatus: "assigned",
        newStatus: "ongoing",
        notes: "Project accepted by editor",
      });

      await project.save();
      await updateEditorAvailability(project.assignedEditor, User, Project);
      await broadcastDashboardUpdate(project);
      await notifyProjectAccepted(project, req.user);

      res.json({ success: true, project: { _id: project._id, status: project.status } });
    } catch (err) {
      console.error("Accept error:", err);
      res.status(500).json({ error: err.message || "Failed to accept project." });
    }
  },
);

// --- Editor: Submit project (ongoing → submitted, with versioned submission) ---

workflowRouter.post(
  "/editor/projects/:id/submit",
  requireDb,
  requireAuth,
  requireEditor,
  async (req, res) => {
    try {
      const { id } = req.params;
      if (!mongoose.isValidObjectId(id)) {
        return res.status(400).json({ error: "Invalid project id." });
      }

      const project = await Project.findById(id);
      if (!project || String(project.assignedEditor) !== String(req.user._id)) {
        return res.status(404).json({ error: "Project not found." });
      }

      if (project.status !== "ongoing") {
        return res.status(400).json({ error: "Only ongoing projects can be submitted." });
      }

      const { driveLink, description } = req.body;
      if (!driveLink || !String(driveLink).trim()) {
        return res.status(400).json({ error: "Drive link is required for submission." });
      }

      const version = (project.submissions?.length || 0) + 1;

      project.submissions.push({
        version,
        driveLink: String(driveLink).trim(),
        description: String(description || "").trim(),
        submittedBy: req.user._id,
        submittedAt: new Date(),
      });

      const fromStatus = project.status;
      project.status = "submitted";
      project.activityTimeline.push({
        action: "Submission Uploaded",
        user: req.user._id,
        userName: req.user.name,
        previousStatus: fromStatus,
        newStatus: "submitted",
        notes: `Version ${version}`,
      });

      await project.save();
      await broadcastDashboardUpdate(project);

      await createNotification({
        recipientRole: "admin",
        project: project._id,
        title: `Submission received: "${project.projectName}"`,
        message: `Version ${version} submitted by ${req.user.name}`,
        type: "submitted",
        actionUrl: `/admin/projects/${project._id}`,
      });

      res.json({ success: true, project: { _id: project._id, status: project.status, version } });
    } catch (err) {
      console.error("Submit error:", err);
      res.status(500).json({ error: err.message || "Failed to submit project." });
    }
  },
);

// --- Editor: My Assets ---

workflowRouter.get(
  "/editor/assets",
  requireDb,
  requireAuth,
  requireEditor,
  async (req, res) => {
    const editorId = req.user._id;

    const projects = await Project.find({ assignedEditor: editorId })
      .sort({ createdAt: -1 })
      .lean();

    res.render("editor/assets", {
      pageTitle: "My Assets",
      activeSection: "assets",
      projects,
      formatStatus,
    });
  },
);

// --- Editor: Profile (self-service UPI update) ---

workflowRouter.get(
  "/editor/profile",
  requireDb,
  requireAuth,
  requireEditor,
  async (req, res) => {
    const editor = await User.findById(req.user._id).lean();

    res.render("editor/profile", {
      pageTitle: "My Profile",
      activeSection: "profile",
      editor,
    });
  },
);

workflowRouter.post(
  "/editor/profile",
  requireDb,
  requireAuth,
  requireEditor,
  async (req, res) => {
    try {
      const { name, upiId } = req.body;
      const editor = await User.findById(req.user._id);

      if (name && String(name).trim()) {
        editor.name = String(name).trim();
      }
      editor.upiId = String(upiId || "").trim();

      await editor.save();

      req.flash("success", "Profile updated.");
      return res.redirect("/editor/profile");
    } catch (err) {
      console.error("Profile update error:", err);
      req.flash("error", err.message || "Failed to update profile.");
      return res.redirect("/editor/profile");
    }
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
          { "client.name": { $regex: q, $options: "i" } },
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
        clientName: p.client?.name || p.clientName || "",
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
