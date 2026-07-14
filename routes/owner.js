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
  if (req.user.role !== "owner") {
    req.flash("error", "Owner access only.");
    return res.redirect("/");
  }
  next();
});

ownerRouter.get("/profits", async (req, res) => {
  try {
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
      pageTitle: "Profit Overview",
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
    console.error("Profits error:", err);
    req.flash("error", "Something went wrong.");
    return res.redirect("/admin");
  }
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
    const totalEditorAmount = allProjects.reduce((s, p) => s + (p.payment?.editorAmount || 0), 0);
    const totalProfit = totalClientAmount - totalEditorAmount;

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
      totalEditorAmount,
      totalProfit,
      totalPaid: allProjects.filter((p) => p.payment?.status === "paid").length,
      formatMoney,
      formatStatus,
    });
  } catch (err) {
    console.error("Analytics error:", err);
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
