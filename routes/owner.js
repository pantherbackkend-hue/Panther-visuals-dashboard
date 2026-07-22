import express from "express";
import mongoose from "mongoose";
import { Project } from "../models/Project.js";
import { User } from "../models/User.js";
import { Notification } from "../models/Notification.js";
import { requireDb } from "../middleware/requireDb.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import {
  formatStatus,
  getBadgeColor,
  getDashboardCounts,
} from "../utils/workflow.js";

export const ownerRouter = express.Router();

ownerRouter.use(requireDb, requireAuth, requireAdmin);

function formatMoney(value) {
  return `₹${Number(value || 0).toFixed(2)}`;
}

ownerRouter.use((req, res, next) => {
  if (req.user.role !== "owner" && req.user.role !== "admin") {
    req.flash("error", "Access denied.");
    return res.redirect("/");
  }
  next();
});

ownerRouter.get("/analytics", async (req, res) => {
  try {
    const allProjects = await Project.find().lean();
    const allUsers = await User.find().select("name email role isActive createdAt").sort({ createdAt: -1 }).lean();
    const counts = getDashboardCounts(allProjects);

    const ownerProjects = allProjects.filter((p) => p.ownerAssignment);
    const directAssign = ownerProjects.filter((p) => p.ownerAssignment === "direct").length;
    const adminAssign = ownerProjects.filter((p) => p.ownerAssignment === "admin").length;

    const totalClientAmount = allProjects.reduce((s, p) => s + (p.payment?.clientAmount || p.payment?.amount || 0), 0);
    const totalPaid = allProjects.filter((p) => p.payment?.status === "paid").length;

    const userBreakdown = {
      owners: allUsers.filter((u) => u.role === "owner").length,
      admins: allUsers.filter((u) => u.role === "admin").length,
      editors: allUsers.filter((u) => u.role === "editor").length,
      total: allUsers.length,
    };

    res.render("admin/analytics", {
      pageTitle: "Analytics",
      activeSection: "analytics",
      counts,
      userBreakdown,
      ownerProjects: ownerProjects.length,
      directAssign,
      adminAssign,
      totalClientAmount,
      totalPaid,
      formatMoney,
      formatStatus,
    });
  } catch (err) {
    console.error("Analytics error:", err);
    req.flash("error", "Something went wrong.");
    return res.redirect("/admin");
  }
});

ownerRouter.get("/payment-status", async (req, res) => {
  try {
    const projects = await Project.find({ status: "completed" })
      .populate("assignedEditor", "name email")
      .populate("ownerAdmin", "name email")
      .populate("clientRef", "name channelName channelUrl email")
      .sort({ completedAt: -1 })
      .lean();

    const jrAdminPayments = projects.filter((p) => p.ownerAssignment === "admin");
    const editorPayments = projects.filter((p) => p.ownerAssignment === "direct");

    const jrAdminPending = jrAdminPayments.filter((p) => !p.payment || p.payment.status === "pending");
    const jrAdminPaid = jrAdminPayments.filter((p) => p.payment?.status === "paid");
    const editorPending = editorPayments.filter((p) => !p.payment || p.payment.status === "pending");
    const editorPaid = editorPayments.filter((p) => p.payment?.status === "paid");

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const paidThisMonth = projects.filter(
      (p) => p.payment?.status === "paid" && p.payment?.paidAt && new Date(p.payment.paidAt) >= startOfMonth
    ).length;

    const outstandingAmount = [...jrAdminPending, ...editorPending].reduce(
      (sum, p) => sum + (p.payment?.editorAmount || 0), 0
    );

    function fmt(p) {
      return {
        ...p,
        clientName: p.clientRef?.name || p.client?.name || p.clientName || "",
        receivedDate: p.receivedDate ? new Date(p.receivedDate).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }) : new Date(p.createdAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }),
        completedDate: p.completedAt ? new Date(p.completedAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }) : "—",
        paymentAmount: p.payment?.editorAmount || 0,
        paymentStatus: p.payment?.status === "paid" ? "Paid" : "Pending",
        paymentBadge: p.payment?.status === "paid" ? "ok" : "pending",
      };
    }

    res.render("admin/payment-status", {
      pageTitle: "Payment Status",
      activeSection: "payment-status",
      jrAdminPending: jrAdminPending.map(fmt),
      jrAdminPaid: jrAdminPaid.map(fmt),
      editorPending: editorPending.map(fmt),
      editorPaid: editorPaid.map(fmt),
      pendingJrAdminCount: jrAdminPending.length,
      pendingEditorCount: editorPending.length,
      paidThisMonth,
      outstandingAmount,
      formatMoney,
      formatStatus,
    });
  } catch (err) {
    console.error("Payment status error:", err);
    req.flash("error", "Something went wrong.");
    return res.redirect("/admin");
  }
});

ownerRouter.get("/users", async (req, res) => {
  try {
    const users = await User.find()
      .select("name email role isActive availability createdAt")
      .sort({ name: 1 })
      .lean();

    res.render("admin/users", {
      pageTitle: "All Users",
      activeSection: "users",
      users,
      formatStatus,
    });
  } catch (err) {
    console.error("Users error:", err);
    req.flash("error", "Something went wrong.");
    return res.redirect("/admin");
  }
});
