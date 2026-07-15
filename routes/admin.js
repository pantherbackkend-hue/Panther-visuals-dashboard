import express from "express";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";

import { Project } from "../models/Project.js";
import { User } from "../models/User.js";
import { Notification } from "../models/Notification.js";
import { getDashboardCounts, formatStatus, getBadgeColor, updateEditorAvailability } from "../utils/workflow.js";
import { notifyProjectAssigned, broadcastDashboardUpdate, broadcastProjectCounts } from "../utils/notifications.js";
import { requireDb } from "../middleware/requireDb.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { normalizeQuery, startOfIstDay } from "../utils/admin.js";

export const adminRouter = express.Router();

adminRouter.use(requireDb, requireAuth, requireAdmin);

function formatMoney(value) {
  return `₹${Number(value || 0).toFixed(2)}`;
}

adminRouter.get("/", async (req, res) => {
  const now = new Date();
  const istStart = startOfIstDay();

  const [
    totalEditors,
    allProjects,
    editors,
    projectsToday,
    pendingAssignmentCount,
    assignedCount,
    workingCount,
    submittedCount,
    completedProjectCount,
    waitingPaymentCount,
    paidCount,
    editorsAvailable,
    editorsBusy,
    editorsLeave,
    recentNotifications,
    recentActivity,
    upcomingDeadlines,
  ] = await Promise.all([
    User.countDocuments({ role: "editor" }),
    Project.find()
      .populate("assignedEditor", "name email")
      .sort({ priority: -1, createdAt: -1 })
      .limit(10)
      .lean(),
    User.find({ role: "editor" }).select("name email availability isActive").sort({ name: 1 }).lean(),
    Project.countDocuments({ createdAt: { $gte: istStart } }),
    Project.countDocuments({ status: "pending_assignment" }),
    Project.countDocuments({ status: "assigned" }),
    Project.countDocuments({ status: "ongoing" }),
    Project.countDocuments({ status: "submitted" }),
    Project.countDocuments({ status: "completed" }),
    Project.countDocuments({ status: "completed", "payment.status": "pending" }),
    Project.countDocuments({ status: "completed", "payment.status": "paid" }),
    User.countDocuments({ role: "editor", availability: "available", isActive: true }),
    User.countDocuments({ role: "editor", availability: "busy", isActive: true }),
    User.countDocuments({ role: "editor", availability: "on_leave", isActive: true }),
    Notification.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .populate("project", "projectName")
      .lean(),
    Project.aggregate([
      { $unwind: "$activityTimeline" },
      { $sort: { "activityTimeline.createdAt": -1 } },
      { $limit: 8 },
      {
        $project: {
          _id: 0,
          projectId: "$_id",
          projectName: 1,
          action: "$activityTimeline.action",
          userName: "$activityTimeline.userName",
          previousStatus: "$activityTimeline.previousStatus",
          newStatus: "$activityTimeline.newStatus",
          notes: "$activityTimeline.notes",
          createdAt: "$activityTimeline.createdAt",
        },
      },
    ]),
    Project.find({
      dueDate: { $gte: now, $ne: null },
      status: { $nin: ["completed"] },
    })
      .select("projectName clientName dueDate priority assignedEditor")
      .populate("assignedEditor", "name")
      .sort({ dueDate: 1 })
      .limit(5)
      .lean(),
  ]);

  const projectCounts = getDashboardCounts(await Project.find().lean());

  const overdueProjects = await Project.countDocuments({
    dueDate: { $lt: now, $ne: null },
    status: { $nin: ["completed"] },
  });

  const profitStats = req.user.role === "admin"
    ? await Project.aggregate([
        {
          $group: {
            _id: null,
            totalClientAmount: { $sum: { $ifNull: ["$payment.clientAmount", { $ifNull: ["$payment.amount", 0] }] } },
            totalEditorAmount: { $sum: { $ifNull: ["$payment.editorAmount", 0] } },
            totalPaid: {
              $sum: { $cond: [{ $eq: ["$payment.status", "paid"] }, 1, 0] },
            },
          },
        },
      ])
    : [];

  const workflowProjects = allProjects.map((p) => ({
    ...p,
    clientName: p.client?.name || p.clientName || "",
    paymentAmount: p.payment?.amount || 0,
    statusLabel: formatStatus(p.status),
    badgeColor: getBadgeColor(p.status),
    ownerAssignmentLabel: p.ownerAssignment === "admin" ? "Via JR Admin" : p.ownerAssignment === "direct" ? "Direct to Editor" : null,
  }));

  const editorWorkload = await Promise.all(
    editors.map(async (e) => {
      const activeCount = await Project.countDocuments({
        assignedEditor: e._id,
        status: { $in: ["assigned", "ongoing"] },
      });
      const workingCount = await Project.countDocuments({
        assignedEditor: e._id,
        status: "ongoing",
      });
      const upcomingDeadline = await Project.findOne({
        assignedEditor: e._id,
        dueDate: { $gte: now, $ne: null },
        status: { $nin: ["completed"] },
      })
        .select("dueDate projectName")
        .sort({ dueDate: 1 })
        .lean();
      const pendingPayment = await Project.countDocuments({
        assignedEditor: e._id,
        status: "completed",
        "payment.status": "pending",
      });
      return {
        name: e.name,
        email: e.email,
        availability: e.availability,
        isActive: e.isActive,
        activeCount,
        workingCount,
        upcomingDeadline: upcomingDeadline || null,
        pendingPayment,
      };
    }),
  );

  const recentActivityTimeline = recentActivity.map((entry) => ({
    ...entry,
    statusLabel: formatStatus(entry.newStatus || entry.previousStatus || ""),
  }));

  const profitData = profitStats.length > 0
    ? {
        totalClientAmount: profitStats[0].totalClientAmount || 0,
        totalEditorAmount: profitStats[0].totalEditorAmount || 0,
        totalProfit: (profitStats[0].totalClientAmount || 0) - (profitStats[0].totalEditorAmount || 0),
        totalPaid: profitStats[0].totalPaid || 0,
      }
    : null;

  res.render("admin/dashboard", {
    pageTitle: "Admin Dashboard",
    activeSection: "dashboard",
    stats: {
      totalEditors,
    },
    projectMetrics: {
      projectsToday,
      pendingAssignment: pendingAssignmentCount,
      assigned: assignedCount,
      working: workingCount,
      waitingReview: submittedCount,
      revision: submittedCount,
      completed: completedProjectCount,
      waitingPayment: waitingPaymentCount,
      paid: paidCount,
    },
    editorMetrics: {
      available: editorsAvailable,
      busy: editorsBusy,
      onLeave: editorsLeave,
    },
    projectCounts,
    workflowProjects,
    editorWorkload,
    overdueProjects,
    recentNotifications,
    recentActivity: recentActivityTimeline,
    upcomingDeadlines,
    profitData,
    formatMoney,
    formatStatus,
  });
});

adminRouter.get("/workspace", async (req, res) => {
  const istStart = startOfIstDay();

  const [
    pendingAssignment,
    working,
    review,
    completedToday,
    allProjects,
    editors,
    recentActivity,
  ] = await Promise.all([
    Project.countDocuments({ status: "pending_assignment" }),
    Project.countDocuments({ status: "ongoing" }),
    Project.countDocuments({ status: "submitted" }),
    Project.countDocuments({ status: "completed", completedAt: { $gte: istStart } }),
    Project.find()
      .populate("assignedEditor", "name email availability")
      .sort({ priority: -1, createdAt: -1 })
      .lean(),
    User.find({ role: "editor", isActive: true })
      .select("name email availability")
      .sort({ name: 1 })
      .lean(),
    Project.aggregate([
      { $match: { "activityTimeline.0": { $exists: true } } },
      { $unwind: "$activityTimeline" },
      { $sort: { "activityTimeline.createdAt": -1 } },
      { $limit: 10 },
      {
        $project: {
          _id: 0,
          projectName: 1,
          action: "$activityTimeline.action",
          userName: "$activityTimeline.userName",
          createdAt: "$activityTimeline.createdAt",
        },
      },
    ]),
  ]);

  const projects = allProjects.map((p) => ({
    ...p,
    clientName: p.client?.name || p.clientName || "",
    latestVersion: p.submissions && p.submissions.length > 0 ? p.submissions[p.submissions.length - 1].version : null,
    statusLabel: formatStatus(p.status),
    badgeColor: getBadgeColor(p.status),
    ownerAssignmentLabel: p.ownerAssignment === "admin" ? "Via JR Admin" : p.ownerAssignment === "direct" ? "Direct to Editor" : null,
  }));

  const activeCounts = await Project.aggregate([
    { $match: { status: { $in: ["assigned", "ongoing"] }, assignedEditor: { $ne: null } } },
    { $group: { _id: "$assignedEditor", count: { $sum: 1 } } },
  ]);
  const countMap = {};
  for (const c of activeCounts) { countMap[String(c._id)] = c.count; }
  const editorsWithCounts = editors.map((e) => ({
    ...e,
    activeCount: countMap[String(e._id)] || 0,
  }));

  res.render("admin/workspace", {
    pageTitle: "Workspace",
    activeSection: "workspace",
    metrics: { pendingAssignment, working, review, completedToday },
    projects,
    editors: editorsWithCounts,
    recentActivity,
  });
});

adminRouter.post("/workspace/assign", async (req, res) => {
  try {
    const { projectId, editorId, assetLink, price, notes } = req.body;

    if (!projectId || !mongoose.isValidObjectId(projectId)) {
      return res.status(400).json({ success: false, error: "Invalid project." });
    }
    if (!editorId || !mongoose.isValidObjectId(editorId)) {
      return res.status(400).json({ success: false, error: "Invalid editor." });
    }

    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ success: false, error: "Project not found." });
    }

    if (project.status !== "pending_assignment") {
      return res.status(400).json({ success: false, error: "Project is already assigned." });
    }

    const editor = await User.findOne({ _id: editorId, role: "editor", isActive: true });
    if (!editor) {
      return res.status(400).json({ success: false, error: "Editor not found or inactive." });
    }

    if (editor.availability === "on_leave") {
      return res.status(400).json({ success: false, error: `${editor.name} is on leave.` });
    }

    if (editor.availability === "busy") {
      const activeCount = await Project.countDocuments({
        assignedEditor: editor._id,
        status: { $in: ["assigned", "ongoing"] },
      });
      if (activeCount >= 3) {
        return res.status(400).json({ success: false, error: `${editor.name} is fully occupied (${activeCount} active projects).` });
      }
    }

    const fromStatus = project.status;
    project.assignedEditor = editor._id;
    project.status = "assigned";

    if (assetLink && typeof assetLink === "string" && assetLink.trim()) {
      try { new URL(assetLink); project.driveLink = assetLink.trim(); } catch { /* ignore invalid URL */ }
    }

    if (price && !isNaN(Number(price))) {
      if (project.ownerAssignment) {
        project.payment.editorAmount = Number(price);
      } else {
        project.payment.amount = Number(price);
        project.payment.clientAmount = Number(price);
      }
    }

    project.activityTimeline.push({
      action: "Assigned",
      user: req.user._id,
      userName: req.user.name,
      previousStatus: fromStatus,
      newStatus: "assigned",
      notes: String(notes || "").trim(),
    });

    await project.save();
    await updateEditorAvailability(editor._id, User, Project);
    await notifyProjectAssigned(project, editor);
    await broadcastDashboardUpdate(project);

    const allProjects = await Project.find().lean();
    const counts = getDashboardCounts(allProjects);
    await broadcastProjectCounts(counts);

    return res.json({ success: true });
  } catch (err) {
    console.error("Workspace assign error:", err);
    return res.status(500).json({ success: false, error: err.message || "Assignment failed." });
  }
});

// --- Editors ---

adminRouter.get("/editors", async (req, res) => {
  const editors = await User.find({ role: "editor" }).sort({ name: 1 }).lean();

  const rows = editors.map((editor) => ({
    ...editor,
    statusLabel: editor.isActive === false ? "Disabled" : "Active",
  }));

  res.render("admin/vendors/index", {
    pageTitle: "Manage Editors",
    activeSection: "editors",
    vendors: rows,
  });
});

adminRouter.get("/editors/new", async (req, res) => {
  res.render("admin/vendors/form", {
    pageTitle: "Create Editor",
    activeSection: "editors",
    mode: "create",
    vendor: null,
  });
});

adminRouter.post("/editors", async (req, res) => {
  try {
    const name = normalizeQuery(req.body?.name);
    const email = normalizeQuery(req.body?.email).toLowerCase();
    const password = String(req.body?.password || "");

    if (!name || !email || !password) {
      req.flash("error", "Name, email, and password are required.");
      return res.redirect("/admin/editors/new");
    }

    const existing = await User.findOne({ email });
    if (existing) { req.flash("error", "That email already exists."); return res.redirect("/admin/editors/new"); }

    const upiId = normalizeQuery(req.body?.upiId);

    const passwordHash = await bcrypt.hash(password, 10);
    const editor = await User.create({ name, email, passwordHash, role: "editor", isActive: true, upiId });

    req.flash("success", "Editor created.");
    return res.redirect("/admin/editors");
  } catch (error) {
    console.error(error);
    req.flash("error", error.message || "Could not create editor.");
    return res.redirect("/admin/editors/new");
  }
});

adminRouter.get("/editors/:id", async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) { req.flash("error", "Editor not found."); return res.redirect("/admin/editors"); }

  const editor = await User.findOne({ _id: id, role: "editor" }).lean();

  if (!editor) { req.flash("error", "Editor not found."); return res.redirect("/admin/editors"); }

  res.render("admin/vendors/show", {
    pageTitle: editor.name,
    activeSection: "editors",
    vendor: editor,
    formatMoney,
  });
});

adminRouter.get("/editors/:id/edit", async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) { req.flash("error", "Editor not found."); return res.redirect("/admin/editors"); }

  const editor = await User.findOne({ _id: id, role: "editor" }).lean();

  if (!editor) { req.flash("error", "Editor not found."); return res.redirect("/admin/editors"); }

  res.render("admin/vendors/form", {
    pageTitle: `Edit ${editor.name}`,
    activeSection: "editors",
    mode: "edit",
    vendor: editor,
  });
});

adminRouter.post("/editors/:id/edit", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) { req.flash("error", "Editor not found."); return res.redirect("/admin/editors"); }

    const editor = await User.findOne({ _id: id, role: "editor" });
    if (!editor) { req.flash("error", "Editor not found."); return res.redirect("/admin/editors"); }

    const name = normalizeQuery(req.body?.name);
    const email = normalizeQuery(req.body?.email).toLowerCase();
    const password = String(req.body?.password || "");
    const activeState = String(req.body?.isActive || "1");

    if (!name || !email) { req.flash("error", "Name and email are required."); return res.redirect(`/admin/editors/${id}/edit`); }

    const conflict = await User.findOne({ email, _id: { $ne: editor._id } });
    if (conflict) { req.flash("error", "That email already exists."); return res.redirect(`/admin/editors/${id}/edit`); }

    const upiId = normalizeQuery(req.body?.upiId);

    editor.name = name;
    editor.email = email;
    editor.upiId = upiId;
    if (password) editor.passwordHash = await bcrypt.hash(password, 10);

    if (activeState === "0") { editor.isActive = false; editor.disabledAt = new Date(); }
    else { editor.isActive = true; editor.disabledAt = null; }

    await editor.save();

    req.flash("success", "Editor updated.");
    return res.redirect("/admin/editors");
  } catch (error) {
    console.error(error);
    req.flash("error", error.message || "Could not update editor.");
    return res.redirect(`/admin/editors/${req.params.id}/edit`);
  }
});

adminRouter.post("/editors/:id/toggle", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) { req.flash("error", "Editor not found."); return res.redirect("/admin/editors"); }

    const editor = await User.findOne({ _id: id, role: "editor" });
    if (!editor) { req.flash("error", "Editor not found."); return res.redirect("/admin/editors"); }

    editor.isActive = !editor.isActive;
    editor.disabledAt = editor.isActive ? null : new Date();
    await editor.save();

    req.flash("success", editor.isActive ? "Editor enabled." : "Editor disabled.");
    return res.redirect("/admin/editors");
  } catch (err) {
    console.error("Editor toggle error:", err);
    req.flash("error", "Something went wrong.");
    return res.redirect("/admin/editors");
  }
});

adminRouter.get("/profits", async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      req.flash("error", "Admin access only.");
      return res.redirect("/admin");
    }

    const allProjects = await Project.find()
      .populate("assignedEditor", "name email")
      .populate("ownerAdmin", "name email")
      .sort({ createdAt: -1 })
      .lean();

    const projects = allProjects.map((p) => {
      const clientAmount = p.payment?.clientAmount || p.payment?.amount || 0;
      const editorAmount = p.payment?.editorAmount || 0;
      const profit = clientAmount - editorAmount;
      return {
        ...p,
        clientName: p.client?.name || p.clientName || "",
        clientAmount,
        editorAmount,
        profit,
        statusLabel: formatStatus(p.status),
        badgeColor: getBadgeColor(p.status),
        profitColor: profit >= 0 ? "var(--success)" : "var(--danger)",
      };
    });

    const totalClientAmount = projects.reduce((s, p) => s + p.clientAmount, 0);
    const totalEditorAmount = projects.reduce((s, p) => s + p.editorAmount, 0);
    const totalProfit = totalClientAmount - totalEditorAmount;
    const totalPaid = projects.filter((p) => p.payment?.status === "paid").length;

    res.render("admin/profits", {
      pageTitle: "Earnings Overview",
      activeSection: "profits",
      projects,
      totalClientAmount,
      totalEditorAmount,
      totalProfit,
      totalPaid,
      formatMoney,
      formatStatus,
      getBadgeColor,
    });
  } catch (err) {
    console.error("Earnings error:", err);
    req.flash("error", "Something went wrong.");
    return res.redirect("/admin");
  }
});

adminRouter.post("/editors/:id/delete", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) { req.flash("error", "Editor not found."); return res.redirect("/admin/editors"); }

    const editor = await User.findOne({ _id: id, role: "editor" });
    if (!editor) { req.flash("error", "Editor not found."); return res.redirect("/admin/editors"); }

    await User.deleteOne({ _id: editor._id });

    req.flash("success", "Editor deleted.");
    return res.redirect("/admin/editors");
  } catch (err) {
    console.error("Editor delete error:", err);
    req.flash("error", "Something went wrong.");
    return res.redirect("/admin/editors");
  }
});

