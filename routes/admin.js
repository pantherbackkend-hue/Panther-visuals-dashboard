import express from "express";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";

import { Project } from "../models/Project.js";
import { Client } from "../models/Client.js";
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
      .populate("clientRef", "name channelName channelUrl email")
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
      .select("projectName client dueDate priority assignedEditor clientRef")
      .populate("assignedEditor", "name")
      .populate("clientRef", "name channelName channelUrl email")
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
    clientName: p.clientRef?.name || p.client?.name || p.clientName || "",
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
  const [allProjects, editors] = await Promise.all([
    Project.find()
      .populate("assignedEditor", "name email availability")
      .populate("clientRef", "name channelName channelUrl email")
      .sort({ priority: -1, createdAt: -1 })
      .lean(),
    User.find({ role: "editor", isActive: true })
      .select("name email availability specialization")
      .sort({ name: 1 })
      .lean(),
  ]);

  const formatted = allProjects.map((p) => ({
    ...p,
    clientName: p.clientRef?.name || p.client?.name || p.clientName || "",
    latestVersion: p.submissions?.length > 0 ? p.submissions[p.submissions.length - 1].version : null,
    statusLabel: formatStatus(p.status),
    badgeColor: getBadgeColor(p.status),
    ownerAssignmentLabel: p.ownerAssignment === "admin" ? "Via JR Admin" : p.ownerAssignment === "direct" ? "Direct to Editor" : null,
  }));

  const myProjects = formatted.filter((p) => ["pending_assignment", "assigned"].includes(p.status));
  const ongoing = formatted.filter((p) => ["ongoing", "submitted"].includes(p.status));
  const completed = formatted.filter((p) => p.status === "completed").sort((a, b) => new Date(b.completedAt || b.createdAt) - new Date(a.completedAt || a.createdAt));

  const activeCounts = await Project.aggregate([
    { $match: { status: { $in: ["assigned", "ongoing"] }, assignedEditor: { $ne: null } } },
    { $group: { _id: "$assignedEditor", count: { $sum: 1 } } },
  ]);
  const countMap = {};
  for (const c of activeCounts) countMap[String(c._id)] = c.count;
  const editorsWithCounts = editors.map((e) => ({
    ...e,
    activeCount: countMap[String(e._id)] || 0,
  }));

  res.render("admin/workspace", {
    pageTitle: "Workspace",
    activeSection: "workspace",
    myProjects,
    ongoing,
    completed,
    editors: editorsWithCounts,
    currentTab: req.query.tab || "my",
    formatStatus,
    formatMoney,
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
  const search = String(req.query?.search || "").trim();

  const filter = { role: "editor" };
  if (search) {
    const regex = { $regex: search, $options: "i" };
    filter.$or = [
      { name: regex },
      { email: regex },
      { specialization: regex },
      { contactNumber: regex },
    ];
  }

  const editors = await User.find(filter).sort({ name: 1 }).lean();

  const activeStatuses = ["assigned", "ongoing", "submitted"];
  const workloadMap = {};
  const workloadDocs = await Project.aggregate([
    { $match: { assignedEditor: { $ne: null }, status: { $in: activeStatuses } } },
    { $group: { _id: "$assignedEditor", count: { $sum: 1 } } },
  ]);
  for (const w of workloadDocs) workloadMap[String(w._id)] = w.count;

  const rows = editors.map((editor) => ({
    ...editor,
    statusLabel: editor.isActive === false ? "Disabled" : "Active",
    workload: workloadMap[String(editor._id)] || 0,
  }));

  res.render("admin/vendors/index", {
    pageTitle: "Manage Editors",
    activeSection: "editors",
    vendors: rows,
    search,
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
    const contactNumber = normalizeQuery(req.body?.contactNumber);
    const specialization = normalizeQuery(req.body?.specialization) || "General Editor";
    const upiId = normalizeQuery(req.body?.upiId);
    const notes = normalizeQuery(req.body?.notes);

    if (!name || !email || !password) {
      req.flash("error", "Name, email, and password are required.");
      return res.redirect("/admin/editors/new");
    }

    if (password.length < 6) {
      req.flash("error", "Password must be at least 6 characters long.");
      return res.redirect("/admin/editors/new");
    }

    const existing = await User.findOne({ email });
    if (existing) { req.flash("error", "That email already exists."); return res.redirect("/admin/editors/new"); }

    const passwordHash = await bcrypt.hash(password, 10);
    const editor = await User.create({
      name, email, passwordHash, role: "editor", isActive: true,
      contactNumber, specialization, upiId, notes,
    });

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
    const contactNumber = normalizeQuery(req.body?.contactNumber);
    const specialization = normalizeQuery(req.body?.specialization) || "General Editor";
    const notes = normalizeQuery(req.body?.notes);
    const upiId = normalizeQuery(req.body?.upiId);
    const activeState = String(req.body?.isActive || "1");

    if (!name || !email) { req.flash("error", "Name and email are required."); return res.redirect(`/admin/editors/${id}/edit`); }

    const conflict = await User.findOne({ email, _id: { $ne: editor._id } });
    if (conflict) { req.flash("error", "That email already exists."); return res.redirect(`/admin/editors/${id}/edit`); }

    editor.name = name;
    editor.email = email;
    editor.contactNumber = contactNumber;
    editor.specialization = specialization;
    editor.notes = notes;
    editor.upiId = upiId;
    if (password) {
      if (password.length < 6) {
        req.flash("error", "Password must be at least 6 characters long.");
        return res.redirect(`/admin/editors/${id}/edit`);
      }
      editor.passwordHash = await bcrypt.hash(password, 10);
    }

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
    const paidProjects = await Project.find({ status: "completed", "payment.status": "paid" })
      .populate("assignedEditor", "name email")
      .populate("ownerAdmin", "name email")
      .populate("createdBy", "name")
      .populate("clientRef", "name channelName channelUrl email")
      .sort({ "payment.paidAt": -1 })
      .lean();

    const ledger = paidProjects.map((p) => {
      const clientAmount = p.payment?.clientAmount || p.payment?.amount || 0;
      const editorAmount = p.payment?.editorAmount || 0;
      const earnings = clientAmount - editorAmount;
      return {
        ...p,
        clientName: p.clientRef?.name || p.client?.name || p.clientName || "",
        clientAmount,
        editorAmount,
        earnings,
        completedAtFormatted: p.completedAt ? new Date(p.completedAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }) : "—",
        paidAtFormatted: p.payment?.paidAt ? new Date(p.payment.paidAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }) : "—",
      };
    });

    const totalProjects = ledger.length;
    const totalClientAmount = ledger.reduce((s, p) => s + p.clientAmount, 0);
    const totalEditorAmount = ledger.reduce((s, p) => s + p.editorAmount, 0);
    const totalEarnings = totalClientAmount - totalEditorAmount;
    const avgEarnings = totalProjects > 0 ? totalEarnings / totalProjects : 0;

    let highestEarning = null;
    let lowestEarning = null;
    if (ledger.length > 0) {
      highestEarning = ledger.reduce((max, p) => p.earnings > max.earnings ? p : max, ledger[0]);
      lowestEarning = ledger.reduce((min, p) => p.earnings < min.earnings ? p : min, ledger[0]);
    }

    const editors = await User.find({ role: "editor", isActive: true }).select("name").sort({ name: 1 }).lean();

    res.render("admin/profits", {
      pageTitle: "Earnings Ledger",
      activeSection: "profits",
      ledger,
      totalProjects,
      totalClientAmount,
      totalEditorAmount,
      totalEarnings,
      avgEarnings,
      highestEarning,
      lowestEarning,
      editors,
      formatMoney,
      formatStatus,
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

    const activeProjects = await Project.countDocuments({ assignedEditor: id, status: { $in: ["assigned", "ongoing", "submitted"] } });
    if (activeProjects > 0) {
      req.flash("error", `Cannot delete: Editor has ${activeProjects} active project(s). Reassign or complete them first.`);
      return res.redirect("/admin/editors");
    }

    await User.deleteOne({ _id: editor._id });

    req.flash("success", "Editor deleted.");
    return res.redirect("/admin/editors");
  } catch (err) {
    console.error("Editor delete error:", err);
    req.flash("error", "Something went wrong.");
    return res.redirect("/admin/editors");
  }
});

// --- Clients ---

function formatDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
}

adminRouter.get("/clients", async (req, res) => {
  try {
    const search = String(req.query.q || "").trim().toLowerCase();
    const filter = {};

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { channelName: { $regex: search, $options: "i" } },
      ];
    }

    const clients = await Client.find(filter).sort({ name: 1 }).lean();

    const projectCounts = await Project.aggregate([
      { $match: { clientRef: { $ne: null } } },
      { $group: { _id: "$clientRef", count: { $sum: 1 } } },
    ]);
    const countMap = {};
    for (const c of projectCounts) {
      countMap[String(c._id)] = c.count;
    }

    const rows = clients.map((c) => ({
      ...c,
      projectCount: countMap[String(c._id)] || 0,
      assetCount: c.assets?.length || 0,
      driveLinkCount: c.driveLinks?.length || 0,
    }));

    res.render("admin/clients/index", {
      pageTitle: "Manage Clients",
      activeSection: "clients",
      clients: rows,
      search,
    });
  } catch (err) {
    console.error("Clients list error:", err);
    req.flash("error", "Something went wrong.");
    return res.redirect("/admin");
  }
});

adminRouter.get("/clients/new", async (req, res) => {
  res.render("admin/clients/form", {
    pageTitle: "New Client",
    activeSection: "clients",
    mode: "create",
    client: null,
  });
});

adminRouter.post("/clients", async (req, res) => {
  try {
    const { name, channelName, channelUrl, email, notes, assets: formAssets } = req.body;

    if (!name || !String(name).trim()) {
      req.flash("error", "Client name is required.");
      return res.redirect("/admin/clients/new");
    }

    const existing = await Client.findOne({ name: { $regex: `^${String(name).trim()}$`, $options: "i" } });
    if (existing) {
      req.flash("error", "A client with this name already exists.");
      return res.redirect("/admin/clients/new");
    }

    var assetData = [];
    if (formAssets && Array.isArray(formAssets)) {
      var defaultIdx = -1;
      for (var i = 0; i < formAssets.length; i++) {
        var a = formAssets[i];
        if (!a || !a.driveLink || !String(a.driveLink).trim()) continue;
        assetData.push({
          label: String(a.label || "").trim(),
          driveLink: String(a.driveLink).trim(),
          description: String(a.description || "").trim(),
        });
        if (a.isDefault === "on" || a.isDefault === true) defaultIdx = assetData.length - 1;
      }
      if (assetData.length === 1) {
        assetData[0].isDefault = true;
      } else if (assetData.length > 1 && defaultIdx === -1) {
        assetData[0].isDefault = true;
      } else if (defaultIdx >= 0) {
        assetData[defaultIdx].isDefault = true;
      }
    }

    await Client.create({
      name: String(name).trim(),
      channelName: String(channelName || "").trim(),
      channelUrl: String(channelUrl || "").trim(),
      email: String(email || "").trim().toLowerCase(),
      notes: String(notes || "").trim(),
      assets: assetData,
      createdBy: req.user._id,
    });

    req.flash("success", "Client created.");
    return res.redirect("/admin/clients");
  } catch (err) {
    console.error("Client create error:", err);
    if (err.code === 11000) {
      req.flash("error", "A client with this name already exists.");
    } else {
      req.flash("error", err.message || "Could not create client.");
    }
    return res.redirect("/admin/clients/new");
  }
});

adminRouter.get("/clients/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      req.flash("error", "Client not found.");
      return res.redirect("/admin/clients");
    }

    const client = await Client.findById(id).lean();
    if (!client) {
      req.flash("error", "Client not found.");
      return res.redirect("/admin/clients");
    }

    const projects = await Project.find({ clientRef: client._id })
      .populate("assignedEditor", "name")
      .sort({ createdAt: -1 })
      .lean();

    const projectRows = projects.map((p) => ({
      _id: p._id,
      projectName: p.projectName,
      status: p.status,
      statusLabel: formatStatus(p.status),
      badgeColor: getBadgeColor(p.status),
      assignedEditorName: p.assignedEditor?.name || "Unassigned",
      createdAt: formatDate(p.createdAt),
      paymentStatus: p.payment?.status || "pending",
    }));

    const recentProjects = projectRows.slice(0, 5);

    const allProjectRefs = await Project.countDocuments({
      $or: [
        { clientRef: client._id },
        { "client.name": client.name, clientRef: null },
      ],
    });

    res.render("admin/clients/show", {
      pageTitle: client.name,
      activeSection: "clients",
      client,
      projects: projectRows,
      recentProjects,
      totalProjects: allProjectRefs,
      formatDate,
      formatStatus,
      getBadgeColor,
      formatMoney: (v) => `₹${Number(v || 0).toFixed(2)}`,
    });
  } catch (err) {
    console.error("Client show error:", err);
    req.flash("error", "Something went wrong.");
    return res.redirect("/admin/clients");
  }
});

adminRouter.get("/clients/:id/edit", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      req.flash("error", "Client not found.");
      return res.redirect("/admin/clients");
    }

    const client = await Client.findById(id).lean();
    if (!client) {
      req.flash("error", "Client not found.");
      return res.redirect("/admin/clients");
    }

    res.render("admin/clients/form", {
      pageTitle: `Edit ${client.name}`,
      activeSection: "clients",
      mode: "edit",
      client,
    });
  } catch (err) {
    console.error("Client edit form error:", err);
    req.flash("error", "Something went wrong.");
    return res.redirect("/admin/clients");
  }
});

adminRouter.post("/clients/:id/edit", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      req.flash("error", "Client not found.");
      return res.redirect("/admin/clients");
    }

    const client = await Client.findById(id);
    if (!client) {
      req.flash("error", "Client not found.");
      return res.redirect("/admin/clients");
    }

    const { name, channelName, channelUrl, email, notes, assets: formAssets } = req.body;

    if (!name || !String(name).trim()) {
      req.flash("error", "Client name is required.");
      return res.redirect(`/admin/clients/${id}/edit`);
    }

    const conflict = await Client.findOne({
      _id: { $ne: client._id },
      name: { $regex: `^${String(name).trim()}$`, $options: "i" },
    });
    if (conflict) {
      req.flash("error", "A client with this name already exists.");
      return res.redirect(`/admin/clients/${id}/edit`);
    }

    client.name = String(name).trim();
    client.channelName = String(channelName || "").trim();
    client.channelUrl = String(channelUrl || "").trim();
    client.email = String(email || "").trim().toLowerCase();
    client.notes = String(notes || "").trim();

    if (formAssets && Array.isArray(formAssets)) {
      var assetData = [];
      var defaultIdx = -1;
      for (var i = 0; i < formAssets.length; i++) {
        var a = formAssets[i];
        if (!a || !a.driveLink || !String(a.driveLink).trim()) continue;
        var entry = {
          label: String(a.label || "").trim(),
          driveLink: String(a.driveLink).trim(),
          description: String(a.description || "").trim(),
        };
        if (a._id && mongoose.isValidObjectId(a._id)) entry._id = a._id;
        if (a.isDefault === "on" || a.isDefault === true) defaultIdx = assetData.length;
        assetData.push(entry);
      }
      if (assetData.length === 1) {
        assetData[0].isDefault = true;
      } else if (assetData.length > 1 && defaultIdx === -1) {
        assetData[0].isDefault = true;
      } else if (defaultIdx >= 0) {
        assetData[defaultIdx].isDefault = true;
      }
      client.assets = assetData;
    }

    await client.save();

    req.flash("success", "Client updated.");
    return res.redirect(`/admin/clients/${id}`);
  } catch (err) {
    console.error("Client update error:", err);
    if (err.code === 11000) {
      req.flash("error", "A client with this name already exists.");
    } else {
      req.flash("error", err.message || "Could not update client.");
    }
    return res.redirect(`/admin/clients/${req.params.id}/edit`);
  }
});

adminRouter.post("/clients/:id/delete", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      req.flash("error", "Client not found.");
      return res.redirect("/admin/clients");
    }

    const client = await Client.findById(id);
    if (!client) {
      req.flash("error", "Client not found.");
      return res.redirect("/admin/clients");
    }

    const referenced = await Project.countDocuments({
      $or: [
        { clientRef: client._id },
        { "client.name": client.name, clientRef: null },
      ],
    });
    if (referenced > 0) {
      req.flash("error", `Cannot delete "${client.name}" because ${referenced} project(s) reference this client. Remove the project references first.`);
      return res.redirect("/admin/clients");
    }

    await Client.deleteOne({ _id: client._id });

    req.flash("success", "Client deleted.");
    return res.redirect("/admin/clients");
  } catch (err) {
    console.error("Client delete error:", err);
    req.flash("error", "Something went wrong.");
    return res.redirect("/admin/clients");
  }
});

// --- Drive Link management ---

adminRouter.post("/clients/:id/drive-links", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      req.flash("error", "Client not found.");
      return res.redirect("/admin/clients");
    }

    const client = await Client.findById(id);
    if (!client) {
      req.flash("error", "Client not found.");
      return res.redirect("/admin/clients");
    }

    const { label, url } = req.body;
    if (!url || !String(url).trim()) {
      req.flash("error", "Drive link URL is required.");
      return res.redirect(`/admin/clients/${id}`);
    }

    client.driveLinks.push({
      label: String(label || "").trim(),
      url: String(url).trim(),
    });

    await client.save();

    req.flash("success", "Drive link added.");
    return res.redirect(`/admin/clients/${id}`);
  } catch (err) {
    console.error("Drive link add error:", err);
    req.flash("error", "Something went wrong.");
    return res.redirect(`/admin/clients/${req.params.id}`);
  }
});

adminRouter.post("/clients/:id/drive-links/:linkId/edit", async (req, res) => {
  try {
    const { id, linkId } = req.params;
    if (!mongoose.isValidObjectId(id) || !mongoose.isValidObjectId(linkId)) {
      req.flash("error", "Invalid request.");
      return res.redirect("/admin/clients");
    }

    const client = await Client.findById(id);
    if (!client) {
      req.flash("error", "Client not found.");
      return res.redirect("/admin/clients");
    }

    const link = client.driveLinks.id(linkId);
    if (!link) {
      req.flash("error", "Drive link not found.");
      return res.redirect(`/admin/clients/${id}`);
    }

    const { label, url } = req.body;
    link.label = String(label || "").trim();
    if (url && String(url).trim()) {
      link.url = String(url).trim();
    }

    await client.save();

    req.flash("success", "Drive link updated.");
    return res.redirect(`/admin/clients/${id}`);
  } catch (err) {
    console.error("Drive link edit error:", err);
    req.flash("error", "Something went wrong.");
    return res.redirect(`/admin/clients/${req.params.id}`);
  }
});

adminRouter.post("/clients/:id/drive-links/:linkId/delete", async (req, res) => {
  try {
    const { id, linkId } = req.params;
    if (!mongoose.isValidObjectId(id) || !mongoose.isValidObjectId(linkId)) {
      req.flash("error", "Invalid request.");
      return res.redirect("/admin/clients");
    }

    const client = await Client.findById(id);
    if (!client) {
      req.flash("error", "Client not found.");
      return res.redirect("/admin/clients");
    }

    const link = client.driveLinks.id(linkId);
    if (!link) {
      req.flash("error", "Drive link not found.");
      return res.redirect(`/admin/clients/${id}`);
    }

    link.deleteOne();
    await client.save();

    req.flash("success", "Drive link deleted.");
    return res.redirect(`/admin/clients/${id}`);
  } catch (err) {
    console.error("Drive link delete error:", err);
    req.flash("error", "Something went wrong.");
    return res.redirect(`/admin/clients/${req.params.id}`);
  }
});

// --- Asset management ---

adminRouter.post("/clients/:id/assets", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      req.flash("error", "Client not found.");
      return res.redirect("/admin/clients");
    }

    const client = await Client.findById(id);
    if (!client) {
      req.flash("error", "Client not found.");
      return res.redirect("/admin/clients");
    }

    const { label, driveLink, description } = req.body;
    if (!driveLink || !String(driveLink).trim()) {
      req.flash("error", "Asset drive link URL is required.");
      return res.redirect(`/admin/clients/${id}`);
    }

    const isDefault = client.assets.length === 0;
    client.assets.push({
      label: String(label || "").trim(),
      driveLink: String(driveLink).trim(),
      description: String(description || "").trim(),
      isDefault,
    });

    await client.save();

    req.flash("success", "Reference asset added.");
    return res.redirect(`/admin/clients/${id}#assets`);
  } catch (err) {
    console.error("Asset add error:", err);
    req.flash("error", "Something went wrong.");
    return res.redirect(`/admin/clients/${req.params.id}`);
  }
});

adminRouter.post("/clients/:id/assets/:assetId/edit", async (req, res) => {
  try {
    const { id, assetId } = req.params;
    if (!mongoose.isValidObjectId(id) || !mongoose.isValidObjectId(assetId)) {
      req.flash("error", "Invalid request.");
      return res.redirect("/admin/clients");
    }

    const client = await Client.findById(id);
    if (!client) {
      req.flash("error", "Client not found.");
      return res.redirect("/admin/clients");
    }

    const asset = client.assets.id(assetId);
    if (!asset) {
      req.flash("error", "Asset not found.");
      return res.redirect(`/admin/clients/${id}`);
    }

    const { label, driveLink, description } = req.body;
    asset.label = String(label || "").trim();
    if (driveLink && String(driveLink).trim()) {
      asset.driveLink = String(driveLink).trim();
    }
    asset.description = String(description || "").trim();

    await client.save();

    req.flash("success", "Reference asset updated.");
    return res.redirect(`/admin/clients/${id}#assets`);
  } catch (err) {
    console.error("Asset edit error:", err);
    req.flash("error", "Something went wrong.");
    return res.redirect(`/admin/clients/${req.params.id}`);
  }
});

adminRouter.post("/clients/:id/assets/:assetId/delete", async (req, res) => {
  try {
    const { id, assetId } = req.params;
    if (!mongoose.isValidObjectId(id) || !mongoose.isValidObjectId(assetId)) {
      req.flash("error", "Invalid request.");
      return res.redirect("/admin/clients");
    }

    const client = await Client.findById(id);
    if (!client) {
      req.flash("error", "Client not found.");
      return res.redirect("/admin/clients");
    }

    const asset = client.assets.id(assetId);
    if (!asset) {
      req.flash("error", "Asset not found.");
      return res.redirect(`/admin/clients/${id}`);
    }

    const wasDefault = asset.isDefault;
    asset.deleteOne();
    await client.save();

    if (wasDefault && client.assets.length > 0) {
      client.assets[0].isDefault = true;
      await client.save();
    }

    req.flash("success", "Reference asset deleted.");
    return res.redirect(`/admin/clients/${id}#assets`);
  } catch (err) {
    console.error("Asset delete error:", err);
    req.flash("error", "Something went wrong.");
    return res.redirect(`/admin/clients/${req.params.id}`);
  }
});

adminRouter.post("/clients/:id/assets/:assetId/default", async (req, res) => {
  try {
    const { id, assetId } = req.params;
    if (!mongoose.isValidObjectId(id) || !mongoose.isValidObjectId(assetId)) {
      req.flash("error", "Invalid request.");
      return res.redirect("/admin/clients");
    }

    const client = await Client.findById(id);
    if (!client) {
      req.flash("error", "Client not found.");
      return res.redirect("/admin/clients");
    }

    const asset = client.assets.id(assetId);
    if (!asset) {
      req.flash("error", "Asset not found.");
      return res.redirect(`/admin/clients/${id}`);
    }

    for (const a of client.assets) {
      a.isDefault = false;
    }
    asset.isDefault = true;
    await client.save();

    req.flash("success", "Default reference asset updated.");
    return res.redirect(`/admin/clients/${id}#assets`);
  } catch (err) {
    console.error("Asset default error:", err);
    req.flash("error", "Something went wrong.");
    return res.redirect(`/admin/clients/${req.params.id}`);
  }
});

adminRouter.post("/clients/:id/drive-links/:linkId/default", async (req, res) => {
  try {
    const { id, linkId } = req.params;
    if (!mongoose.isValidObjectId(id) || !mongoose.isValidObjectId(linkId)) {
      req.flash("error", "Invalid request.");
      return res.redirect("/admin/clients");
    }

    const client = await Client.findById(id);
    if (!client) {
      req.flash("error", "Client not found.");
      return res.redirect("/admin/clients");
    }

    const link = client.driveLinks.id(linkId);
    if (!link) {
      req.flash("error", "Drive link not found.");
      return res.redirect(`/admin/clients/${id}`);
    }

    for (const dl of client.driveLinks) {
      dl.isDefault = false;
    }
    link.isDefault = true;
    await client.save();

    req.flash("success", "Default drive link updated.");
    return res.redirect(`/admin/clients/${id}`);
  } catch (err) {
    console.error("Drive link default error:", err);
    req.flash("error", "Something went wrong.");
    return res.redirect(`/admin/clients/${req.params.id}`);
  }
});

