import express from "express";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";

import { Project } from "../models/Project.js";
import { User } from "../models/User.js";
import { Shop } from "../models/Shop.js";
import { Notification } from "../models/Notification.js";
import { getDashboardCounts, formatStatus, getBadgeColor, updateEditorAvailability } from "../utils/workflow.js";
import { notifyProjectAssigned, broadcastDashboardUpdate, broadcastProjectCounts } from "../utils/notifications.js";
import { requireDb } from "../middleware/requireDb.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { handleShopImageUpload } from "../middleware/upload.js";
import { normalizeQuery, startOfIstDay } from "../utils/admin.js";

export const adminRouter = express.Router();

adminRouter.use(requireDb, requireAuth, requireAdmin);

function toHexId(value) {
  return value ? String(value) : "";
}

function safeSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatMoney(value) {
  return `₹${Number(value || 0).toFixed(2)}`;
}

async function syncVendorShopLink({ vendorId = null, shopId = null }) {
  const vendor =
    vendorId && mongoose.isValidObjectId(vendorId)
      ? await User.findById(vendorId)
      : null;
  const shop =
    shopId && mongoose.isValidObjectId(shopId)
      ? await Shop.findById(shopId)
      : null;

  if (vendor && vendor.role !== "editor") {
    throw new Error("Selected user is not an editor.");
  }

  const currentVendorShopId = vendor?.shop ? toHexId(vendor.shop) : null;
  const currentShopVendorId = shop?.vendor ? toHexId(shop.vendor) : null;

  if (vendor && currentVendorShopId && currentVendorShopId !== toHexId(shop?._id)) {
    const previousShop = await Shop.findById(currentVendorShopId);
    if (previousShop && toHexId(previousShop.vendor) === toHexId(vendor._id)) {
      previousShop.vendor = null;
      await previousShop.save();
    }
  }

  if (shop && currentShopVendorId && currentShopVendorId !== toHexId(vendor?._id)) {
    const previousVendor = await User.findById(currentShopVendorId);
    if (previousVendor && toHexId(previousVendor.shop) === toHexId(shop._id)) {
      previousVendor.shop = null;
      await previousVendor.save();
    }
  }

  if (vendor) {
    vendor.shop = shop ? shop._id : null;
    await vendor.save();
  }

  if (shop) {
    shop.vendor = vendor ? vendor._id : null;
    await shop.save();
  }
}

adminRouter.get("/", async (req, res) => {
  const now = new Date();
  const istStart = startOfIstDay();

  const [
    totalShops,
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
    Shop.countDocuments(),
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

  const workflowProjects = allProjects.map((p) => ({
    ...p,
    clientName: p.client?.name || p.clientName || "",
    paymentAmount: p.payment?.amount || 0,
    statusLabel: formatStatus(p.status),
    badgeColor: getBadgeColor(p.status),
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

  res.render("admin/dashboard", {
    pageTitle: "Admin Dashboard",
    activeSection: "dashboard",
    stats: {
      totalShops,
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
      project.payment.amount = Number(price);
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

// --- Workspaces (Shops) ---

adminRouter.get("/shops", async (req, res) => {
  const shops = await Shop.find().sort({ name: 1 }).populate("vendor", "name email role isActive").lean();

  const rows = shops.map((shop) => ({
    ...shop,
    assignedVendorName: shop.vendor?.name || "Unassigned",
    statusLabel: shop.isActive === false ? "Disabled" : shop.isOpen === false ? "Closed" : "Open",
  }));

  res.render("admin/shops/index", {
    pageTitle: "Manage Workspaces",
    activeSection: "shops",
    shops: rows,
  });
});

adminRouter.get("/shops/new", async (req, res) => {
  const editors = await User.find({ role: "editor" }).sort({ name: 1 }).lean();
  res.render("admin/shops/form", {
    pageTitle: "Create Workspace",
    activeSection: "shops",
    mode: "create",
    shop: null,
    vendors: editors,
  });
});

adminRouter.post("/shops", handleShopImageUpload("/admin/shops/new"), async (req, res) => {
  try {
    const name = normalizeQuery(req.body?.name);
    const slug = safeSlug(req.body?.slug || name);
    const description = normalizeQuery(req.body?.description);
    const isOpen = String(req.body?.isOpen || "open") !== "closed";
    const assignedVendorId = normalizeQuery(req.body?.vendor);

    if (!name) { req.flash("error", "Workspace name is required."); return res.redirect("/admin/shops/new"); }
    if (!slug) { req.flash("error", "Workspace slug is required."); return res.redirect("/admin/shops/new"); }

    const existing = await Shop.findOne({ slug });
    if (existing) { req.flash("error", "That slug already exists."); return res.redirect("/admin/shops/new"); }

    const shop = await Shop.create({ name, slug, description, image: req.file?.path || "", isOpen, isActive: true });

    if (assignedVendorId) {
      await syncVendorShopLink({ vendorId: assignedVendorId, shopId: shop._id });
    }

    req.flash("success", "Workspace created.");
    return res.redirect("/admin/shops");
  } catch (error) {
    console.error(error);
    req.flash("error", error.message || "Could not create workspace.");
    return res.redirect("/admin/shops/new");
  }
});

adminRouter.get("/shops/:id", async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) { req.flash("error", "Workspace not found."); return res.redirect("/admin/shops"); }

  const shop = await Shop.findById(id).populate("vendor", "name email role isActive").lean();
  if (!shop) { req.flash("error", "Workspace not found."); return res.redirect("/admin/shops"); }

  res.render("admin/shops/show", {
    pageTitle: shop.name,
    activeSection: "shops",
    shop,
    menuItems: [],
    stats: { totalOrders: 0, completedOrders: 0, revenue: 0 },
    formatMoney,
  });
});

adminRouter.get("/shops/:id/edit", async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) { req.flash("error", "Workspace not found."); return res.redirect("/admin/shops"); }

  const [shop, editors] = await Promise.all([
    Shop.findById(id).populate("vendor", "name email").lean(),
    User.find({ role: "editor" }).sort({ name: 1 }).lean(),
  ]);

  if (!shop) { req.flash("error", "Workspace not found."); return res.redirect("/admin/shops"); }

  res.render("admin/shops/form", {
    pageTitle: `Edit ${shop.name}`,
    activeSection: "shops",
    mode: "edit",
    shop,
    vendors: editors,
  });
});

adminRouter.post("/shops/:id/edit", handleShopImageUpload((req) => `/admin/shops/${req.params.id}/edit`), async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) { req.flash("error", "Workspace not found."); return res.redirect("/admin/shops"); }

    const shop = await Shop.findById(id);
    if (!shop) { req.flash("error", "Workspace not found."); return res.redirect("/admin/shops"); }

    const name = normalizeQuery(req.body?.name);
    const slug = safeSlug(req.body?.slug || name);
    const description = normalizeQuery(req.body?.description);
    const isOpen = String(req.body?.isOpen || "open") !== "closed";
    const assignedVendorId = normalizeQuery(req.body?.vendor);

    if (!name) { req.flash("error", "Workspace name is required."); return res.redirect(`/admin/shops/${id}/edit`); }
    if (!slug) { req.flash("error", "Workspace slug is required."); return res.redirect(`/admin/shops/${id}/edit`); }

    const slugConflict = await Shop.findOne({ slug, _id: { $ne: shop._id } });
    if (slugConflict) { req.flash("error", "That slug already exists."); return res.redirect(`/admin/shops/${id}/edit`); }

    shop.name = name;
    shop.slug = slug;
    shop.description = description;
    shop.isOpen = isOpen;
    if (req.file?.path) shop.image = req.file.path;
    await shop.save();

    if (assignedVendorId) {
      await syncVendorShopLink({ vendorId: assignedVendorId, shopId: shop._id });
    } else if (shop.vendor) {
      const previousVendor = await User.findById(shop.vendor);
      if (previousVendor && toHexId(previousVendor.shop) === toHexId(shop._id)) {
        previousVendor.shop = null;
        await previousVendor.save();
      }
      shop.vendor = null;
      await shop.save();
    }

    req.flash("success", "Workspace updated.");
    return res.redirect("/admin/shops");
  } catch (error) {
    console.error(error);
    req.flash("error", error.message || "Could not update workspace.");
    return res.redirect(`/admin/shops/${req.params.id}/edit`);
  }
});

adminRouter.post("/shops/:id/toggle", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) { req.flash("error", "Workspace not found."); return res.redirect("/admin/shops"); }

    const shop = await Shop.findById(id);
    if (!shop) { req.flash("error", "Workspace not found."); return res.redirect("/admin/shops"); }

    shop.isActive = !shop.isActive;
    shop.disabledAt = shop.isActive ? null : new Date();
    if (!shop.isActive) shop.isOpen = false;
    await shop.save();

    req.flash("success", shop.isActive ? "Workspace enabled." : "Workspace disabled.");
    return res.redirect("/admin/shops");
  } catch (err) {
    console.error("Shop toggle error:", err);
    req.flash("error", "Something went wrong.");
    return res.redirect("/admin/shops");
  }
});

adminRouter.post("/shops/:id/delete", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) { req.flash("error", "Workspace not found."); return res.redirect("/admin/shops"); }

    const shop = await Shop.findById(id);
    if (!shop) { req.flash("error", "Workspace not found."); return res.redirect("/admin/shops"); }

    if (shop.vendor) {
      const vendor = await User.findById(shop.vendor);
      if (vendor && toHexId(vendor.shop) === toHexId(shop._id)) {
        vendor.shop = null;
        await vendor.save();
      }
    }

    await Shop.deleteOne({ _id: shop._id });

    req.flash("success", "Workspace deleted.");
    return res.redirect("/admin/shops");
  } catch (err) {
    console.error("Shop delete error:", err);
    req.flash("error", "Something went wrong.");
    return res.redirect("/admin/shops");
  }
});



// --- Editors ---

adminRouter.get("/editors", async (req, res) => {
  const editors = await User.find({ role: "editor" }).sort({ name: 1 }).populate("shop", "name slug isActive isOpen vendor").lean();

  const rows = editors.map((editor) => ({
    ...editor,
    assignedShopName: editor.shop?.name || "Unassigned",
    statusLabel: editor.isActive === false ? "Disabled" : "Active",
  }));

  res.render("admin/vendors/index", {
    pageTitle: "Manage Editors",
    activeSection: "editors",
    vendors: rows,
  });
});

adminRouter.get("/editors/new", async (req, res) => {
  const shops = await Shop.find().sort({ name: 1 }).lean();
  res.render("admin/vendors/form", {
    pageTitle: "Create Editor",
    activeSection: "editors",
    mode: "create",
    vendor: null,
    shops,
  });
});

adminRouter.post("/editors", async (req, res) => {
  try {
    const name = normalizeQuery(req.body?.name);
    const email = normalizeQuery(req.body?.email).toLowerCase();
    const password = String(req.body?.password || "");
    const assignedShopId = normalizeQuery(req.body?.shop);

    if (!name || !email || !password) {
      req.flash("error", "Name, email, and password are required.");
      return res.redirect("/admin/editors/new");
    }

    const existing = await User.findOne({ email });
    if (existing) { req.flash("error", "That email already exists."); return res.redirect("/admin/editors/new"); }

    const upiId = normalizeQuery(req.body?.upiId);

    const passwordHash = await bcrypt.hash(password, 10);
    const editor = await User.create({ name, email, passwordHash, role: "editor", isActive: true, upiId });

    if (assignedShopId) {
      await syncVendorShopLink({ vendorId: editor._id, shopId: assignedShopId });
    }

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

  const editor = await User.findOne({ _id: id, role: "editor" })
    .populate({ path: "shop", populate: { path: "vendor", select: "name email" } })
    .lean();

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

  const [editor, shops] = await Promise.all([
    User.findOne({ _id: id, role: "editor" }).populate("shop", "name slug").lean(),
    Shop.find().sort({ name: 1 }).lean(),
  ]);

  if (!editor) { req.flash("error", "Editor not found."); return res.redirect("/admin/editors"); }

  res.render("admin/vendors/form", {
    pageTitle: `Edit ${editor.name}`,
    activeSection: "editors",
    mode: "edit",
    vendor: editor,
    shops,
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
    const assignedShopId = normalizeQuery(req.body?.shop);
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

    if (assignedShopId) {
      await syncVendorShopLink({ vendorId: editor._id, shopId: assignedShopId });
    } else if (editor.shop) {
      await syncVendorShopLink({ vendorId: editor._id, shopId: null });
    }

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

adminRouter.post("/editors/:id/delete", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) { req.flash("error", "Editor not found."); return res.redirect("/admin/editors"); }

    const editor = await User.findOne({ _id: id, role: "editor" });
    if (!editor) { req.flash("error", "Editor not found."); return res.redirect("/admin/editors"); }

    if (editor.shop) await syncVendorShopLink({ vendorId: editor._id, shopId: null });
    await User.deleteOne({ _id: editor._id });

    req.flash("success", "Editor deleted.");
    return res.redirect("/admin/editors");
  } catch (err) {
    console.error("Editor delete error:", err);
    req.flash("error", "Something went wrong.");
    return res.redirect("/admin/editors");
  }
});

