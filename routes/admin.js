import express from "express";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";

import { Order } from "../models/Order.js";
import { Project } from "../models/Project.js";
import { User } from "../models/User.js";
import { Shop } from "../models/Shop.js";
import { MenuItem } from "../models/MenuItem.js";
import { Notification } from "../models/Notification.js";
import { getDashboardCounts, formatStatus, getBadgeColor } from "../utils/workflow.js";
import { requireDb } from "../middleware/requireDb.js";
import { requireAuth, requireAdmin, resolveAdminVendorShop } from "../middleware/auth.js";
import { handleShopImageUpload, handleAdminMenuImageUpload } from "../middleware/upload.js";
import { uploadImportFile } from "../menu-import/upload.js";
import { stageImport, markProcessing, markError, discardImport } from "../menu-import/importer.js";
import { updateSession, getSession } from "../menu-import/store.js";
import { extractMenu } from "../menu-import/vision.js";
import { isGatewayConfigured } from "./editor.js";
import {
  formatOrderStatus,
  normalizeQuery,
  startOfIstDay,
  startOfIstMonth,
  startOfIstWeek,
} from "../utils/admin.js";

export const adminRouter = express.Router();

adminRouter.use(requireDb, requireAuth, requireAdmin);

function toHexId(value) {
  return value ? String(value) : "";
}

function orderNumber(order) {
  return toHexId(order?._id).slice(-6).toUpperCase();
}

function safeSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

async function loadShopOrderCounts() {
  const rows = await Order.aggregate([
    {
      $group: {
        _id: "$shop",
        totalOrders: { $sum: 1 },
        completedOrders: {
          $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
        },
      },
    },
  ]);

  const map = new Map();
  rows.forEach((row) => {
    map.set(toHexId(row._id), {
      totalOrders: row.totalOrders || 0,
      completedOrders: row.completedOrders || 0,
    });
  });
  return map;
}

async function loadEditorCompletedCounts() {
  const rows = await Order.aggregate([
    { $match: { status: "completed" } },
    { $group: { _id: "$shop", completedOrders: { $sum: 1 } } },
  ]);

  const map = new Map();
  rows.forEach((row) => {
    map.set(toHexId(row._id), row.completedOrders || 0);
  });
  return map;
}

async function loadClientOrderStats() {
  const rows = await Order.aggregate([
    {
      $group: {
        _id: "$customer",
        totalOrders: { $sum: 1 },
        lastOrderDate: { $max: "$createdAt" },
      },
    },
  ]);

  const map = new Map();
  rows.forEach((row) => {
    map.set(toHexId(row._id), {
      totalOrders: row.totalOrders || 0,
      lastOrderDate: row.lastOrderDate || null,
    });
  });
  return map;
}

function humanizeTimeHour(hour) {
  if (hour === null || typeof hour === "undefined") return "Unknown";
  const normalized = Number(hour);
  if (!Number.isFinite(normalized)) return "Unknown";
  const suffix = normalized >= 12 ? "PM" : "AM";
  const value = normalized % 12 || 12;
  return `${value} ${suffix}`;
}

async function loadAdminOrderList() {
  return Order.find()
    .sort({ createdAt: -1 })
    .populate({ path: "customer", select: "name email role isActive" })
    .populate({
      path: "shop",
      select: "name slug vendor isActive isOpen",
      populate: { path: "vendor", select: "name email role isActive" },
    })
    .lean();
}

function matchesOrderSearch(order, searchValue) {
  if (!searchValue) return true;
  const haystack = [
    orderNumber(order),
    toHexId(order._id),
    order.customer?.name,
    order.customer?.email,
    order.shop?.name,
    order.shop?.vendor?.name,
    order.shop?.vendor?.email,
    order.paymentNote,
    order.transactionId,
    order.adjustmentReason,
    order.refundStatus,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(searchValue);
}

function matchesOrderFilter(order, filterValue) {
  if (!filterValue) return true;
  const createdAt = new Date(order.createdAt);
  if (filterValue === "today") return createdAt >= startOfIstDay();
  if (filterValue === "week") return createdAt >= startOfIstWeek();
  if (filterValue === "month") return createdAt >= startOfIstMonth();
  if (filterValue === "pending") return order.status === "pending";
  if (filterValue === "assigned") return order.status === "assigned";
  if (filterValue === "in_progress") return order.status === "in_progress";
  if (filterValue === "review") return order.status === "review";
  if (filterValue === "completed") return order.status === "completed";
  if (filterValue === "cancelled") return order.status === "cancelled";
  return true;
}

function paymentStatusLabel(order) {
  if (order.status === "cancelled") {
    return order.refundStatus === "completed" ? "Refunded" : "Cancelled";
  }
  if (order.status === "pending_payment") return "Pending";
  if (order.paymentNote && order.paymentNote !== "mock") return "Captured";
  return "Paid";
}

adminRouter.get("/", async (req, res) => {
  const now = new Date();
  const istStart = startOfIstDay();

  const [
    totalShops,
    totalEditors,
    totalClients,
    totalOrders,
    ordersToday,
    completedOrders,
    pendingOrders,
    recentOrders,
    allProjects,
    editors,
    projectsToday,
    pendingAssignmentCount,
    assignedCount,
    workingCount,
    waitingReviewCount,
    revisionCount,
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
    User.countDocuments({ role: "client" }),
    Order.countDocuments(),
    Order.countDocuments({ createdAt: { $gte: istStart } }),
    Order.countDocuments({ status: "completed" }),
    Order.countDocuments({ status: { $in: ["pending", "assigned"] } }),
    Order.find()
      .sort({ createdAt: -1 })
      .limit(8)
      .populate({ path: "customer", select: "name email" })
      .populate({
        path: "shop",
        select: "name slug",
        populate: { path: "vendor", select: "name email" },
      })
      .lean(),
    Project.find()
      .populate("assignedEditor", "name email")
      .sort({ priority: -1, createdAt: -1 })
      .limit(10)
      .lean(),
    User.find({ role: "editor" }).select("name email availability isActive").sort({ name: 1 }).lean(),
    Project.countDocuments({ createdAt: { $gte: istStart } }),
    Project.countDocuments({ status: "pending_assignment" }),
    Project.countDocuments({ status: "assigned" }),
    Project.countDocuments({ status: { $in: ["accepted_by_editor", "working"] } }),
    Project.countDocuments({ status: { $in: ["completed", "waiting_for_payment"] } }),
    Project.countDocuments({ status: { $in: ["revision_1", "revision_2", "revision_3"] } }),
    Project.countDocuments({ status: "completed" }),
    Project.countDocuments({ status: "waiting_for_payment" }),
    Project.countDocuments({ status: "paid" }),
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
      status: { $nin: ["completed", "paid", "archived", "waiting_for_payment"] },
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
    status: { $nin: ["completed", "paid", "archived", "waiting_for_payment"] },
  });

  const workflowProjects = allProjects.map((p) => ({
    ...p,
    statusLabel: formatStatus(p.status),
    badgeColor: getBadgeColor(p.status),
  }));

  const editorWorkload = await Promise.all(
    editors.map(async (e) => {
      const activeCount = await Project.countDocuments({
        assignedEditor: e._id,
        status: { $in: ["assigned", "accepted_by_editor", "working", "revision_1", "revision_2", "revision_3"] },
      });
      const workingCount = await Project.countDocuments({
        assignedEditor: e._id,
        status: { $in: ["accepted_by_editor", "working"] },
      });
      const upcomingDeadline = await Project.findOne({
        assignedEditor: e._id,
        dueDate: { $gte: now, $ne: null },
        status: { $nin: ["completed", "paid", "archived", "waiting_for_payment"] },
      })
        .select("dueDate projectName")
        .sort({ dueDate: 1 })
        .lean();
      const pendingPayment = await Project.countDocuments({
        assignedEditor: e._id,
        status: "waiting_for_payment",
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
      totalClients,
      totalOrders,
      ordersToday,
      completedOrders,
      pendingOrders,
    },
    projectMetrics: {
      projectsToday,
      pendingAssignment: pendingAssignmentCount,
      assigned: assignedCount,
      working: workingCount,
      waitingReview: waitingReviewCount,
      revision: revisionCount,
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
    recentOrders,
    recentNotifications,
    recentActivity: recentActivityTimeline,
    upcomingDeadlines,
    orderNumber,
    formatOrderStatus,
    formatMoney,
    formatStatus,
  });
});

// --- Workspaces (Shops) ---

adminRouter.get("/shops", async (req, res) => {
  const [shops, orderCounts] = await Promise.all([
    Shop.find().sort({ name: 1 }).populate("vendor", "name email role isActive").lean(),
    loadShopOrderCounts(),
  ]);

  const rows = shops.map((shop) => {
    const counts = orderCounts.get(toHexId(shop._id)) || { totalOrders: 0, completedOrders: 0 };
    return {
      ...shop,
      totalOrders: counts.totalOrders,
      completedOrders: counts.completedOrders,
      assignedVendorName: shop.vendor?.name || "Unassigned",
      statusLabel: shop.isActive === false ? "Disabled" : shop.isOpen === false ? "Closed" : "Open",
    };
  });

  res.render("admin/shops/index", {
    pageTitle: "Manage Workspaces",
    activeSection: "shops",
    shops: rows,
    orderNumber,
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

  const [shop, menuItems, orderStats] = await Promise.all([
    Shop.findById(id).populate("vendor", "name email role isActive").lean(),
    MenuItem.find({ shop: id }).sort({ name: 1 }).lean(),
    Order.aggregate([
      { $match: { shop: new mongoose.Types.ObjectId(id) } },
      {
        $group: {
          _id: "$shop",
          totalOrders: { $sum: 1 },
          completedOrders: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
          revenue: { $sum: { $cond: [{ $in: ["$status", ["pending", "assigned", "in_progress", "review", "completed"]] }, "$total", 0] } },
        },
      },
    ]),
  ]);

  if (!shop) { req.flash("error", "Workspace not found."); return res.redirect("/admin/shops"); }

  res.render("admin/shops/show", {
    pageTitle: shop.name,
    activeSection: "shops",
    shop,
    menuItems,
    stats: {
      totalOrders: orderStats[0]?.totalOrders || 0,
      completedOrders: orderStats[0]?.completedOrders || 0,
      revenue: orderStats[0]?.revenue || 0,
    },
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
});

adminRouter.post("/shops/:id/delete", async (req, res) => {
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

  await MenuItem.deleteMany({ shop: shop._id });
  await Shop.deleteOne({ _id: shop._id });

  req.flash("success", "Workspace deleted.");
  return res.redirect("/admin/shops");
});

adminRouter.get("/shops/:id/payment-settings", async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) { req.flash("error", "Workspace not found."); return res.redirect("/admin/shops"); }

  const shop = await Shop.findById(id).lean();
  if (!shop) { req.flash("error", "Workspace not found."); return res.redirect("/admin/shops"); }

  res.render("admin/shops/payment-settings", {
    pageTitle: `Payment Settings - ${shop.name}`,
    activeSection: "shops",
    shop,
  });
});

adminRouter.post("/shops/:id/payment-settings", async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) { req.flash("error", "Workspace not found."); return res.redirect("/admin/shops"); }

  try {
    const { paymentGateway, razorpayKeyId, razorpayKeySecret, easebuzzMerchantKey, easebuzzSalt, easebuzzEnv, phonepeClientId, phonepeClientSecret, phonepeClientVersion, phonepeEnv } = req.body;

    const shop = await Shop.findById(id);
    if (!shop) { req.flash("error", "Workspace not found."); return res.redirect("/admin/shops"); }

    if (paymentGateway !== undefined) {
      if (!["razorpay", "easebuzz", "phonepe", "paytm", "bharatpe"].includes(paymentGateway)) {
        req.flash("error", "Invalid payment gateway.");
        return res.redirect(`/admin/shops/${id}/payment-settings`);
      }
      shop.paymentGateway = paymentGateway;
    }

    const keyId = String(razorpayKeyId || "").trim();
    if (keyId) shop.paymentSettings.razorpay.keyId = keyId;
    if (razorpayKeySecret !== undefined && String(razorpayKeySecret).trim()) {
      shop.paymentSettings.razorpay.keySecret = String(razorpayKeySecret).trim();
    }

    const merchantKey = String(easebuzzMerchantKey || "").trim();
    if (merchantKey) shop.paymentSettings.easebuzz.merchantKey = merchantKey;
    if (easebuzzSalt !== undefined && String(easebuzzSalt).trim()) {
      shop.paymentSettings.easebuzz.salt = String(easebuzzSalt).trim();
    }
    if (easebuzzEnv !== undefined && ["test", "prod"].includes(easebuzzEnv)) {
      shop.paymentSettings.easebuzz.env = easebuzzEnv;
    }

    const ppClientId = String(phonepeClientId || "").trim();
    if (ppClientId) shop.paymentSettings.phonepe.clientId = ppClientId;
    if (phonepeClientSecret !== undefined && String(phonepeClientSecret).trim()) {
      shop.paymentSettings.phonepe.clientSecret = String(phonepeClientSecret).trim();
    }
    if (phonepeClientVersion !== undefined && String(phonepeClientVersion).trim()) {
      shop.paymentSettings.phonepe.clientVersion = String(phonepeClientVersion).trim();
    }
    if (phonepeEnv !== undefined && ["UAT", "PROD"].includes(phonepeEnv)) {
      shop.paymentSettings.phonepe.env = phonepeEnv;
    }

    shop.paymentConfigured = isGatewayConfigured(shop);
    await shop.save();

    req.flash("success", "Payment settings saved successfully.");
    return res.redirect(`/admin/shops/${id}`);
  } catch (err) {
    console.error("Error updating payment settings:", err);
    req.flash("error", "Failed to save payment settings.");
    return res.redirect(`/admin/shops/${id}/payment-settings`);
  }
});

// --- Editors ---

adminRouter.get("/editors", async (req, res) => {
  const [editors, completedCounts] = await Promise.all([
    User.find({ role: "editor" }).sort({ name: 1 }).populate("shop", "name slug isActive isOpen vendor").lean(),
    loadEditorCompletedCounts(),
  ]);

  const rows = editors.map((editor) => ({
    ...editor,
    completedOrders: completedCounts.get(toHexId(editor.shop?._id || editor.shop)) || 0,
    assignedShopName: editor.shop?.name || "Unassigned",
    statusLabel: editor.isActive === false ? "Disabled" : "Active",
  }));

  res.render("admin/vendors/index", {
    pageTitle: "Manage Editors",
    activeSection: "editors",
    vendors: rows,
    orderNumber,
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

    const passwordHash = await bcrypt.hash(password, 10);
    const editor = await User.create({ name, email, passwordHash, role: "editor", isActive: true });

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

  const recentOrders = await Order.find({ shop: editor.shop?._id || editor.shop })
    .sort({ createdAt: -1 })
    .limit(8)
    .populate("customer", "name email")
    .lean();

  const completedOrders = editor.shop
    ? await Order.countDocuments({ shop: editor.shop._id, status: "completed" })
    : 0;

  res.render("admin/vendors/show", {
    pageTitle: editor.name,
    activeSection: "editors",
    vendor: editor,
    completedOrders,
    recentOrders,
    formatMoney,
    orderNumber,
    formatOrderStatus,
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

    editor.name = name;
    editor.email = email;
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
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) { req.flash("error", "Editor not found."); return res.redirect("/admin/editors"); }

  const editor = await User.findOne({ _id: id, role: "editor" });
  if (!editor) { req.flash("error", "Editor not found."); return res.redirect("/admin/editors"); }

  editor.isActive = !editor.isActive;
  editor.disabledAt = editor.isActive ? null : new Date();
  await editor.save();

  req.flash("success", editor.isActive ? "Editor enabled." : "Editor disabled.");
  return res.redirect("/admin/editors");
});

adminRouter.post("/editors/:id/delete", async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) { req.flash("error", "Editor not found."); return res.redirect("/admin/editors"); }

  const editor = await User.findOne({ _id: id, role: "editor" });
  if (!editor) { req.flash("error", "Editor not found."); return res.redirect("/admin/editors"); }

  if (editor.shop) await syncVendorShopLink({ vendorId: editor._id, shopId: null });
  await User.deleteOne({ _id: editor._id });

  req.flash("success", "Editor deleted.");
  return res.redirect("/admin/editors");
});

// --- Clients ---

adminRouter.get("/clients", async (req, res) => {
  const [clients, orderStats] = await Promise.all([
    User.find({ role: "client" }).sort({ name: 1 }).lean(),
    loadClientOrderStats(),
  ]);

  const rows = clients.map((client) => {
    const stats = orderStats.get(toHexId(client._id)) || { totalOrders: 0, lastOrderDate: null };
    return { ...client, totalOrders: stats.totalOrders, lastOrderDate: stats.lastOrderDate, statusLabel: client.isActive === false ? "Disabled" : "Active" };
  });

  res.render("admin/students/index", {
    pageTitle: "Manage Clients",
    activeSection: "clients",
    students: rows,
  });
});

adminRouter.get("/clients/:id", async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) { req.flash("error", "Client not found."); return res.redirect("/admin/clients"); }

  const client = await User.findOne({ _id: id, role: "client" }).lean();
  if (!client) { req.flash("error", "Client not found."); return res.redirect("/admin/clients"); }

  const recentOrders = await Order.find({ customer: client._id })
    .sort({ createdAt: -1 })
    .limit(10)
    .populate({ path: "shop", select: "name slug", populate: { path: "vendor", select: "name email" } })
    .lean();

  const [stats] = await Order.aggregate([
    { $match: { customer: client._id } },
    { $group: { _id: "$customer", totalOrders: { $sum: 1 }, lastOrderDate: { $max: "$createdAt" } } },
  ]);

  res.render("admin/students/show", {
    pageTitle: client.name,
    activeSection: "clients",
    student: client,
    stats: { totalOrders: stats?.totalOrders || 0, lastOrderDate: stats?.lastOrderDate || null },
    recentOrders,
    formatMoney,
    orderNumber,
    formatOrderStatus,
  });
});

adminRouter.post("/clients/:id/toggle", async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) { req.flash("error", "Client not found."); return res.redirect("/admin/clients"); }

  const client = await User.findOne({ _id: id, role: "client" });
  if (!client) { req.flash("error", "Client not found."); return res.redirect("/admin/clients"); }

  client.isActive = !client.isActive;
  client.disabledAt = client.isActive ? null : new Date();
  await client.save();

  req.flash("success", client.isActive ? "Client enabled." : "Client disabled.");
  return res.redirect("/admin/clients");
});

// --- Orders / Projects ---

adminRouter.get("/orders", async (req, res) => {
  const filter = normalizeQuery(req.query.filter).toLowerCase();
  const search = normalizeQuery(req.query.q).toLowerCase();
  const allOrders = await loadAdminOrderList();

  const rows = allOrders
    .filter((o) => matchesOrderFilter(o, filter))
    .filter((o) => matchesOrderSearch(o, search))
    .map((o) => ({
      ...o,
      orderNumber: orderNumber(o),
      paymentStatus: paymentStatusLabel(o),
      statusLabel: formatOrderStatus(o.status),
      customerName: o.customer?.name || "Client",
      shopName: o.shop?.name || "Deleted workspace",
      vendorName: o.shop?.vendor?.name || "Unassigned",
    }));

  res.render("admin/orders/index", {
    pageTitle: "Manage Projects",
    activeSection: "projects",
    orders: rows,
    filter,
    search,
  });
});

adminRouter.get("/orders/:id", async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) { req.flash("error", "Project not found."); return res.redirect("/admin/orders"); }

  const order = await Order.findById(id)
    .populate({ path: "customer", select: "name email role isActive" })
    .populate({
      path: "shop",
      select: "name slug vendor isOpen isActive description image",
      populate: { path: "vendor", select: "name email role isActive" },
    })
    .lean();

  if (!order) { req.flash("error", "Project not found."); return res.redirect("/admin/orders"); }

  res.render("admin/orders/show", {
    pageTitle: `Project ${orderNumber(order)}`,
    activeSection: "projects",
    order,
    orderNumber,
    formatOrderStatus,
    paymentStatus: paymentStatusLabel(order),
    formatMoney,
  });
});

adminRouter.get("/assets", async (req, res) => {
  const [editors, menuCounts] = await Promise.all([
    User.find({ role: "editor" }).sort({ name: 1 }).populate("shop", "name slug isActive isOpen").lean(),
    MenuItem.aggregate([{ $group: { _id: "$shop", count: { $sum: 1 } } }]),
  ]);

  const countsMap = new Map();
  menuCounts.forEach((row) => countsMap.set(toHexId(row._id), row.count));

  const rows = editors.map((editor) => ({
    ...editor,
    menuCount: countsMap.get(toHexId(editor.shop?._id || editor.shop)) || 0,
    assignedShopName: editor.shop?.name || "Unassigned",
    statusLabel: editor.isActive === false ? "Disabled" : "Active",
    shopStatusLabel: editor.shop?.isActive === false ? "Disabled" : editor.shop?.isOpen === false ? "Closed" : "Open",
  }));

  res.render("admin/menus/index", {
    pageTitle: "Manage Assets",
    activeSection: "assets",
    vendors: rows,
  });
});

adminRouter.get("/editors/:vendorId/assets", resolveAdminVendorShop, async (req, res) => {
  const assets = await MenuItem.find({ shop: req.vendorShopId }).sort({ name: 1 }).lean();
  res.render("admin/vendors/menu", {
    pageTitle: `Assets – ${req.targetVendor.name}`,
    activeSection: "assets",
    vendor: req.targetVendor,
    shop: req.targetShop,
    menuItems: assets,
  });
});

adminRouter.post("/editors/:vendorId/assets", resolveAdminVendorShop, handleAdminMenuImageUpload((req) => `/admin/editors/${req.params.vendorId}/assets`), async (req, res) => {
  const shop = await Shop.findById(req.vendorShopId).lean();
  if (!shop || shop.isActive === false) { req.flash("error", "This workspace is disabled."); return res.redirect(`/admin/editors/${req.params.vendorId}/assets`); }

  const name = String((req.body && req.body.name) || "").trim();
  const description = String((req.body && req.body.description) || "").trim();
  const price = Number((req.body && req.body.price) || 0);
  const image = req.file?.path || "";

  if (!name) { req.flash("error", "Name is required."); return res.redirect(`/admin/editors/${req.params.vendorId}/assets`); }
  if (!Number.isFinite(price) || price <= 0) { req.flash("error", "Price must be greater than 0."); return res.redirect(`/admin/editors/${req.params.vendorId}/assets`); }

  await MenuItem.create({ shop: req.vendorShopId, name, description, price, image });
  req.flash("success", "Asset created.");
  return res.redirect(`/admin/editors/${req.params.vendorId}/assets`);
});

adminRouter.patch("/editors/:vendorId/assets/:id", resolveAdminVendorShop, handleAdminMenuImageUpload((req) => `/admin/editors/${req.params.vendorId}/assets`), async (req, res) => {
  const activeShop = await Shop.findById(req.vendorShopId).lean();
  if (!activeShop || activeShop.isActive === false) return res.status(403).json({ error: "This workspace is disabled." });

  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) return res.status(400).json({ error: "Invalid asset id." });

  const item = await MenuItem.findOne({ _id: id, shop: req.vendorShopId });
  if (!item) return res.status(404).json({ error: "Asset not found." });

  const name = String((req.body && req.body.name) || "").trim();
  const description = String((req.body && req.body.description) || "").trim();
  const price = Number((req.body && req.body.price) || 0);

  if (!name) return res.status(400).json({ error: "Name is required." });
  if (!Number.isFinite(price) || price <= 0) return res.status(400).json({ error: "Price must be greater than 0." });

  item.name = name;
  item.description = description;
  item.price = price;
  if (req.file?.path) item.image = req.file.path;
  await item.save();

  return res.json({ success: true, message: "Asset updated.", item: { _id: String(item._id), name: item.name, description: item.description, price: item.price, image: item.image, available: item.available } });
});

adminRouter.delete("/editors/:vendorId/assets/:id", resolveAdminVendorShop, async (req, res) => {
  const activeShop = await Shop.findById(req.vendorShopId).lean();
  if (!activeShop || activeShop.isActive === false) return res.status(403).json({ error: "This workspace is disabled." });

  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) return res.status(400).json({ error: "Invalid asset id." });

  const result = await MenuItem.deleteOne({ _id: id, shop: req.vendorShopId });
  if (!result.deletedCount) return res.status(404).json({ error: "Asset not found." });

  return res.json({ success: true, message: "Asset deleted." });
});

adminRouter.patch("/editors/:vendorId/assets/:id/toggle", resolveAdminVendorShop, async (req, res) => {
  const activeShop = await Shop.findById(req.vendorShopId).lean();
  if (!activeShop || activeShop.isActive === false) return res.status(403).json({ error: "This workspace is disabled." });

  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) return res.status(400).json({ error: "Invalid asset id." });

  const item = await MenuItem.findOne({ _id: id, shop: req.vendorShopId });
  if (!item) return res.status(404).json({ error: "Asset not found." });

  item.available = !item.available;
  await item.save();

  return res.json({ item: { _id: String(item._id), name: item.name, price: item.price, available: item.available } });
});

adminRouter.post("/editors/:vendorId/shop/toggle", resolveAdminVendorShop, async (req, res) => {
  try {
    const shop = await Shop.findById(req.vendorShopId);
    if (!shop) { req.flash("error", "Workspace not found."); return res.redirect(`/admin/editors/${req.params.vendorId}/assets`); }
    shop.isOpen = !shop.isOpen;
    await shop.save();
    req.flash("success", shop.isOpen ? "Workspace opened." : "Workspace closed.");
    return res.redirect(`/admin/editors/${req.params.vendorId}/assets`);
  } catch (error) {
    console.error(error);
    req.flash("error", "Failed to update workspace status.");
    return res.redirect(`/admin/editors/${req.params.vendorId}/assets`);
  }
});

// --- Smart Import ---

adminRouter.get("/editors/:vendorId/assets/import", resolveAdminVendorShop, async (req, res) => {
  res.render("admin/vendors/menu-import", {
    pageTitle: `Import Assets – ${req.targetVendor.name}`,
    activeSection: "assets",
    vendor: req.targetVendor,
    shop: req.targetShop,
  });
});

adminRouter.post("/editors/:vendorId/assets/import", resolveAdminVendorShop, (req, res, next) => {
  uploadImportFile.single("importFile")(req, res, (err) => {
    if (err) { req.flash("error", err.message || "Upload failed."); return res.redirect(`/admin/editors/${req.params.vendorId}/assets/import`); }
    next();
  });
}, async (req, res) => {
  if (!req.file) { req.flash("error", "No file was uploaded."); return res.redirect(`/admin/editors/${req.params.vendorId}/assets/import`); }

  let importId;
  try {
    const staged = await stageImport(req.file, req.params.vendorId, req.vendorShopIdStr);
    importId = staged.importId;
  } catch (err) {
    console.error("stageImport failed:", err);
    req.flash("error", err.message || "Failed to process import.");
    return res.redirect(`/admin/editors/${req.params.vendorId}/assets/import`);
  }

  try { markProcessing(importId); } catch (err) {
    console.error("markProcessing failed:", err);
    req.flash("error", err.message || "Failed to process import.");
    return res.redirect(`/admin/editors/${req.params.vendorId}/assets/import`);
  }

  let result;
  try {
    result = await extractMenu(req.file.path);
  } catch (err) {
    console.error("extractMenu failed:", err);
    try { markError(importId, err.message || "Extraction failed."); } catch {}
    req.flash("error", err.message || "Failed to process import.");
    return res.redirect(`/admin/editors/${req.params.vendorId}/assets/import`);
  }

  const hasItems = result.items.length > 0;
  const errorMsg = result.metadata?.error || null;

  try {
    if (hasItems) {
      updateSession(importId, { status: "ready", visionResult: { items: result.items, rawText: result.rawText, metadata: result.metadata } });
    } else {
      updateSession(importId, { status: "error", visionResult: { items: [], rawText: result.rawText, metadata: result.metadata }, errors: errorMsg ? [errorMsg] : [] });
    }
  } catch (err) {
    console.error("updateSession failed:", err);
    req.flash("error", err.message || "Failed to process import.");
    return res.redirect(`/admin/editors/${req.params.vendorId}/assets/import`);
  }

  res.render("admin/vendors/menu-import-preview", {
    pageTitle: hasItems ? "Review Extracted Items" : "Extraction Failed",
    activeSection: "assets",
    vendor: req.targetVendor,
    shop: req.targetShop,
    importId,
    fileName: req.file.originalname,
    items: result.items,
    rawText: result.rawText,
    avgConfidence: result.metadata.averageConfidence || 0,
    itemCount: result.metadata.itemCount || 0,
    visionError: errorMsg,
    provider: result.metadata.provider || "gemini-vision",
  });
});

adminRouter.post("/editors/:vendorId/assets/import/confirm", resolveAdminVendorShop, async (req, res) => {
  try {
    const { importId } = req.body;
    if (!importId) { req.flash("error", "Import session not found."); return res.redirect(`/admin/editors/${req.params.vendorId}/assets`); }

    const session = getSession(importId);
    if (!session) { req.flash("error", "Import session has expired."); return res.redirect(`/admin/editors/${req.params.vendorId}/assets`); }

    const shop = await Shop.findById(req.vendorShopId).lean();
    if (!shop || shop.isActive === false) { req.flash("error", "This workspace is disabled."); return res.redirect(`/admin/editors/${req.params.vendorId}/assets`); }

    const rawItems = req.body.items;
    if (!rawItems || (Array.isArray(rawItems) && rawItems.length === 0)) { req.flash("error", "No items to import."); return res.redirect(`/admin/editors/${req.params.vendorId}/assets/import`); }

    const items = Array.isArray(rawItems) ? rawItems : [rawItems];
    const docs = [];

    for (const item of items) {
      const name = String(item.name || "").trim();
      const description = String(item.description || "").trim();
      const price = Number(item.price) || 0;
      if (!name || price <= 0) continue;

      docs.push({ shop: req.vendorShopId, name, description, price, available: true });
    }

    if (docs.length === 0) { req.flash("error", "No valid items to import."); return res.redirect(`/admin/editors/${req.params.vendorId}/assets/import`); }

    await MenuItem.insertMany(docs);
    discardImport(importId);

    req.flash("success", `${docs.length} asset(s) imported successfully.`);
    return res.redirect(`/admin/editors/${req.params.vendorId}/assets`);
  } catch (err) {
    console.error("Import confirm error:", err);
    req.flash("error", err.message || "Failed to import assets.");
    return res.redirect(`/admin/editors/${req.params.vendorId}/assets/import`);
  }
});

// --- Analytics ---

adminRouter.get("/analytics", async (req, res) => {
  const [totalRevenueAgg, ordersToday, ordersThisWeek, ordersThisMonth, popularShop, popularItem, peakHour, topShops, topVendors] = await Promise.all([
    Order.aggregate([
      { $match: { status: { $in: ["pending", "assigned", "in_progress", "review", "completed"] } } },
      { $group: { _id: null, total: { $sum: "$total" } } },
    ]),
    Order.countDocuments({ createdAt: { $gte: startOfIstDay() } }),
    Order.countDocuments({ createdAt: { $gte: startOfIstWeek() } }),
    Order.countDocuments({ createdAt: { $gte: startOfIstMonth() } }),
    Order.aggregate([
      { $group: { _id: "$shop", orders: { $sum: 1 }, revenue: { $sum: "$total" } } },
      { $sort: { orders: -1, revenue: -1 } }, { $limit: 1 },
      { $lookup: { from: "shops", localField: "_id", foreignField: "_id", as: "shop" } },
      { $unwind: { path: "$shop", preserveNullAndEmptyArrays: true } },
      { $project: { orders: 1, revenue: 1, name: "$shop.name", slug: "$shop.slug" } },
    ]),
    Order.aggregate([
      { $unwind: "$items" },
      { $match: { "items.status": { $ne: "removed" } } },
      { $group: { _id: "$items.name", quantity: { $sum: "$items.quantity" }, revenue: { $sum: { $multiply: ["$items.price", "$items.quantity"] } } } },
      { $sort: { quantity: -1, revenue: -1 } }, { $limit: 1 },
    ]),
    Order.aggregate([
      { $group: { _id: { $hour: { date: "$createdAt", timezone: "Asia/Kolkata" } }, orders: { $sum: 1 } } },
      { $sort: { orders: -1, _id: 1 } }, { $limit: 1 },
    ]),
    Order.aggregate([
      { $group: { _id: "$shop", orders: { $sum: 1 }, revenue: { $sum: "$total" } } },
      { $sort: { orders: -1, revenue: -1 } }, { $limit: 5 },
      { $lookup: { from: "shops", localField: "_id", foreignField: "_id", as: "shop" } },
      { $unwind: { path: "$shop", preserveNullAndEmptyArrays: true } },
      { $project: { orders: 1, revenue: 1, shopName: "$shop.name", shopSlug: "$shop.slug" } },
    ]),
    Order.aggregate([
      { $lookup: { from: "shops", localField: "shop", foreignField: "_id", as: "shop" } },
      { $unwind: { path: "$shop", preserveNullAndEmptyArrays: true } },
      { $lookup: { from: "users", localField: "shop.vendor", foreignField: "_id", as: "vendor" } },
      { $unwind: { path: "$vendor", preserveNullAndEmptyArrays: true } },
      { $group: { _id: "$shop.vendor", vendorName: { $first: "$vendor.name" }, vendorEmail: { $first: "$vendor.email" }, shopName: { $first: "$shop.name" }, orders: { $sum: 1 }, revenue: { $sum: "$total" } } },
      { $sort: { orders: -1, revenue: -1 } }, { $limit: 5 },
    ]),
  ]);

  res.render("admin/analytics", {
    pageTitle: "Analytics",
    activeSection: "analytics",
    stats: { totalRevenue: totalRevenueAgg[0]?.total || 0, ordersToday, ordersThisWeek, ordersThisMonth },
    mostPopularShop: popularShop[0] || null,
    mostPopularItem: popularItem[0] || null,
    peakHour: peakHour[0] ? humanizeTimeHour(peakHour[0]._id) : "Unknown",
    topShops,
    topVendors,
    formatMoney,
  });
});
