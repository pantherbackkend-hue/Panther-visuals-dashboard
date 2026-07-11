import express from "express";
import mongoose from "mongoose";
import { Order } from "../models/Order.js";
import { MenuItem } from "../models/MenuItem.js";
import { Shop } from "../models/Shop.js";
import { requireDb } from "../middleware/requireDb.js";
import {
  requireAuth,
  requireEditor,
  requireVendorShop,
} from "../middleware/auth.js";
import { handleMenuImageUpload } from "../middleware/upload.js";
import { createRazorpayFromShop } from "../config/razorpay.js";
import {
  getPhonepeFromShop,
  getAuthToken,
  refundPayment,
} from "../config/phonepe.js";
import { emitPendingCount } from "../socket/index.js";

export const editorRouter = express.Router();

export function isGatewayConfigured(shop) {
  if (shop.paymentGateway === "easebuzz") {
    return !!(shop.paymentSettings?.easebuzz?.merchantKey && shop.paymentSettings?.easebuzz?.salt);
  }
  if (shop.paymentGateway === "phonepe") {
    return !!(shop.paymentSettings?.phonepe?.clientId && shop.paymentSettings?.phonepe?.clientSecret);
  }
  return !!(shop.paymentSettings?.razorpay?.keyId && shop.paymentSettings?.razorpay?.keySecret);
}

async function refundViaRazorpay(order, shop) {
  const { instance } = createRazorpayFromShop(shop);
  const paymentId = order.razorpayPaymentId;
  const payment = await instance.payments.fetch(paymentId);
  if (payment.status !== "captured") {
    throw new Error("Only captured payments can be refunded.");
  }
  return instance.payments.refund(paymentId, {
    amount: Math.round(order.total * 100),
    speed: "normal",
    notes: { reason: "Editor cancelled project" },
  });
}

async function refundViaPhonePe(order, shop) {
  const phonepe = getPhonepeFromShop(shop);
  const auth = await getAuthToken({
    clientId: phonepe.clientId,
    clientSecret: phonepe.clientSecret,
    clientVersion: phonepe.clientVersion,
    env: phonepe.env,
  });
  if (!auth || !auth.access_token) {
    throw new Error("Failed to authenticate with PhonePe.");
  }
  const merchantRefundId = `${order.gatewayTxnId}_refund_${Date.now()}`;
  return refundPayment({
    accessToken: auth.access_token,
    merchantOrderId: order.gatewayTxnId,
    transactionId: order.transactionId,
    amount: order.total,
    merchantRefundId,
    env: phonepe.env,
  });
}

async function partialRefundViaRazorpay(order, shop, refundAmount) {
  const { instance } = createRazorpayFromShop(shop);
  const paymentId = order.razorpayPaymentId;
  const payment = await instance.payments.fetch(paymentId);
  if (payment.status !== "captured") {
    throw new Error("Only captured payments can be refunded.");
  }
  return instance.payments.refund(paymentId, {
    amount: Math.round(refundAmount * 100),
    speed: "normal",
    notes: { reason: `Adjustment refund: ${order.adjustmentReason || "Items removed"}` },
  });
}

async function partialRefundViaPhonePe(order, shop, refundAmount) {
  const phonepe = getPhonepeFromShop(shop);
  const auth = await getAuthToken({
    clientId: phonepe.clientId,
    clientSecret: phonepe.clientSecret,
    clientVersion: phonepe.clientVersion,
    env: phonepe.env,
  });
  if (!auth || !auth.access_token) {
    throw new Error("Failed to authenticate with PhonePe.");
  }
  const merchantRefundId = `${order.gatewayTxnId}_adj_${Date.now()}`;
  return refundPayment({
    accessToken: auth.access_token,
    merchantOrderId: order.gatewayTxnId,
    transactionId: order.transactionId,
    amount: refundAmount,
    merchantRefundId,
    env: phonepe.env,
  });
}

editorRouter.get(
  "/editor/assets",
  requireDb,
  requireAuth,
  requireEditor,
  requireVendorShop,
  async (req, res) => {
    const shop = await Shop.findById(req.vendorShopId).lean();
    if (!shop) {
      req.flash("error", "Workspace not found.");
      return res.redirect("/");
    }
    if (shop && typeof shop.isOpen !== "boolean") shop.isOpen = true;
    const assets = await MenuItem.find({ shop: req.vendorShopId })
      .sort({ name: 1 })
      .lean();
    res.render("vendor/menu", {
      pageTitle: "My Assets",
      shop,
      menuItems: assets,
    });
  },
);

editorRouter.post(
  "/editor/shop/toggle",
  requireDb,
  requireAuth,
  requireEditor,
  requireVendorShop,
  async (req, res) => {
    try {
      const shop = await Shop.findById(req.vendorShopId);
      if (!shop) {
        req.flash("error", "Workspace not found.");
        return res.redirect("/editor/assets");
      }
      if (shop.isActive === false) {
        req.flash("error", "This workspace is disabled by an admin.");
        return res.redirect("/editor/assets");
      }
      shop.isOpen = !shop.isOpen;
      await shop.save();
      req.flash("success", shop.isOpen ? "Workspace opened." : "Workspace closed.");
      return res.redirect("/editor/assets");
    } catch (error) {
      console.error(error);
      req.flash("error", "Failed to update workspace status.");
      return res.redirect("/editor/assets");
    }
  },
);

editorRouter.post(
  "/editor/assets",
  requireDb,
  requireAuth,
  requireEditor,
  requireVendorShop,
  handleMenuImageUpload,
  async (req, res) => {
    const shop = await Shop.findById(req.vendorShopId).lean();
    if (!shop || shop.isActive === false) {
      req.flash("error", "This workspace is disabled by an admin.");
      return res.redirect("/editor/assets");
    }
    const name = String((req.body && req.body.name) || "").trim();
    const description = String((req.body && req.body.description) || "").trim();
    const price = Number((req.body && req.body.price) || 0);
    const image = req.file?.path || "";

    if (!name) {
      req.flash("error", "Name is required.");
      return res.redirect("/editor/assets");
    }
    if (!Number.isFinite(price) || price <= 0) {
      req.flash("error", "Price must be greater than 0.");
      return res.redirect("/editor/assets");
    }

    await MenuItem.create({
      shop: req.vendorShopId,
      name,
      description,
      price,
      image,
    });

    req.flash("success", "Asset created.");
    return res.redirect("/editor/assets");
  },
);

editorRouter.patch(
  "/editor/assets/:id",
  requireDb,
  requireAuth,
  requireEditor,
  requireVendorShop,
  handleMenuImageUpload,
  async (req, res) => {
    const activeShop = await Shop.findById(req.vendorShopId).lean();
    if (!activeShop || activeShop.isActive === false) {
      return res.status(403).json({ error: "This workspace is disabled by an admin." });
    }
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ error: "Invalid asset id." });
    }

    const item = await MenuItem.findOne({ _id: id, shop: req.vendorShopId });
    if (!item) {
      return res.status(404).json({ error: "Asset not found." });
    }

    const name = String((req.body && req.body.name) || "").trim();
    const description = String((req.body && req.body.description) || "").trim();
    const price = Number((req.body && req.body.price) || 0);

    if (!name) {
      return res.status(400).json({ error: "Name is required." });
    }
    if (!Number.isFinite(price) || price <= 0) {
      return res.status(400).json({ error: "Price must be greater than 0." });
    }

    item.name = name;
    item.description = description;
    item.price = price;
    if (req.file?.path) {
      item.image = req.file.path;
    }
    await item.save();

    return res.json({
      success: true,
      message: "Asset updated.",
      item: {
        _id: String(item._id),
        name: item.name,
        description: item.description,
        price: item.price,
        image: item.image,
        available: item.available,
      },
    });
  },
);

editorRouter.delete(
  "/editor/assets/:id",
  requireDb,
  requireAuth,
  requireEditor,
  requireVendorShop,
  async (req, res) => {
    const activeShop = await Shop.findById(req.vendorShopId).lean();
    if (!activeShop || activeShop.isActive === false) {
      return res.status(403).json({ error: "This workspace is disabled by an admin." });
    }
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ error: "Invalid asset id." });
    }

    const result = await MenuItem.deleteOne({ _id: id, shop: req.vendorShopId });
    if (!result.deletedCount) {
      return res.status(404).json({ error: "Asset not found." });
    }

    return res.json({ success: true, message: "Asset deleted." });
  },
);

async function getPendingOrders(shopId) {
  return Order.aggregate([
    {
      $match: {
        shop: shopId,
        status: { $in: ["pending", "assigned"] },
      },
    },
    {
      $addFields: {
        priorityTime: { $ifNull: ["$createdAt", "$createdAt"] },
      },
    },
    {
      $sort: { priorityTime: 1, createdAt: 1 },
    },
    {
      $project: { priorityTime: 0 },
    },
  ]);
}

editorRouter.get(
  "/editor/projects/pending",
  requireDb,
  requireAuth,
  requireEditor,
  requireVendorShop,
  async (req, res) => {
    const orders = await getPendingOrders(req.vendorShopId);
    res.render("vendor/pending-orders", {
      pageTitle: "Pending Projects",
      orders,
    });
  },
);

editorRouter.get(
  "/editor/projects/pending.json",
  requireDb,
  requireAuth,
  requireEditor,
  requireVendorShop,
  async (req, res) => {
    try {
      const orders = await getPendingOrders(req.vendorShopId);
      const payload = orders.map((order) => ({
        id: String(order._id),
        shortId: String(order._id).slice(-6).toUpperCase(),
        status: order.status,
        total: Number(order.total),
        items: (order.items || [])
          .filter((item) => item.status !== "removed")
          .map((item) => ({
            name: item.name,
            quantity: item.quantity,
            variantName: item.variantName || null,
          })),
      }));
      res.json({ projects: payload });
    } catch (err) {
      console.error("Failed to load pending projects JSON:", err);
      res.status(500).json({ error: "Failed to load pending projects." });
    }
  },
);

editorRouter.post(
  "/editor/projects/:id/accept",
  requireDb,
  requireAuth,
  requireEditor,
  requireVendorShop,
  async (req, res) => {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      req.flash("error", "Invalid project.");
      return res.redirect("/editor/projects/pending");
    }

    const order = await Order.findById(id);
    if (!order || String(order.shop) !== req.vendorShopIdStr) {
      req.flash("error", "Project not found.");
      return res.redirect("/editor/projects/pending");
    }

    if (order.status !== "pending") {
      req.flash("error", "Only pending projects can be accepted.");
      return res.redirect("/editor/projects/pending");
    }

    order.status = "assigned";
    await order.save();

    emitPendingCount(order.shop);

    req.flash("success", "Project accepted. Start working on it.");
    return res.redirect("/editor/projects/pending");
  },
);

editorRouter.post(
  "/editor/projects/:id/start",
  requireDb,
  requireAuth,
  requireEditor,
  requireVendorShop,
  async (req, res) => {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      req.flash("error", "Invalid project.");
      return res.redirect("/editor/projects/pending");
    }

    const order = await Order.findById(id);
    if (!order || String(order.shop) !== req.vendorShopIdStr) {
      req.flash("error", "Project not found.");
      return res.redirect("/editor/projects/pending");
    }

    if (order.status !== "assigned") {
      req.flash("error", "Only assigned projects can be started.");
      return res.redirect("/editor/projects/pending");
    }

    order.status = "in_progress";
    await order.save();

    req.flash("success", "Project is now in progress.");
    return res.redirect("/editor/projects/pending");
  },
);

editorRouter.post(
  "/editor/projects/:id/review",
  requireDb,
  requireAuth,
  requireEditor,
  requireVendorShop,
  async (req, res) => {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      req.flash("error", "Invalid project.");
      return res.redirect("/editor/projects/pending");
    }

    const order = await Order.findById(id);
    if (!order || String(order.shop) !== req.vendorShopIdStr) {
      req.flash("error", "Project not found.");
      return res.redirect("/editor/projects/pending");
    }

    if (order.status !== "in_progress") {
      req.flash("error", "Only in-progress projects can be sent for review.");
      return res.redirect("/editor/projects/pending");
    }

    order.status = "review";
    await order.save();

    req.flash("success", "Project sent for client review.");
    return res.redirect("/editor/projects/pending");
  },
);

editorRouter.post(
  "/editor/projects/:id/complete",
  requireDb,
  requireAuth,
  requireEditor,
  requireVendorShop,
  async (req, res) => {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      req.flash("error", "Invalid project.");
      return res.redirect("/editor/projects/pending");
    }

    const order = await Order.findById(id);
    if (!order || String(order.shop) !== req.vendorShopIdStr) {
      req.flash("error", "Project not found.");
      return res.redirect("/editor/projects/pending");
    }

    if (order.status !== "review") {
      req.flash("error", "Only projects in review can be completed.");
      return res.redirect("/editor/projects/pending");
    }

    order.status = "completed";
    await order.save();

    req.flash("success", "Project completed.");
    return res.redirect("/editor/projects/pending");
  },
);

editorRouter.post(
  "/editor/projects/:id/cancel",
  requireDb,
  requireAuth,
  requireEditor,
  requireVendorShop,
  async (req, res) => {
    let order = null;

    try {
      if (!mongoose.isValidObjectId(req.params.id)) {
        req.flash("error", "Project not found.");
        return res.redirect("/editor/projects/pending");
      }

      order = await Order.findOne({ _id: req.params.id, shop: req.vendorShopId });
      if (!order) {
        req.flash("error", "Project not found.");
        return res.redirect("/editor/projects/pending");
      }

      if (!["pending", "assigned", "in_progress"].includes(order.status)) {
        req.flash("error", "This project cannot be cancelled.");
        return res.redirect("/editor/projects/pending");
      }

      const shop = await Shop.findById(req.vendorShopId)
        .select("paymentGateway paymentConfigured paymentSettings")
        .lean();

      const gateway = shop?.paymentGateway || "razorpay";

      if (order.paymentNote === "mock") {
        order.status = "cancelled";
        order.refundStatus = "completed";
        await order.save();
        emitPendingCount(order.shop);
        req.flash("success", "Project cancelled.");
        return res.redirect("/editor/projects/pending");
      }

      order.refundStatus = "pending";
      await order.save();

      if (gateway === "razorpay") {
        if (!order.razorpayPaymentId) {
          order.refundStatus = "failed";
          await order.save();
          req.flash("error", "Invalid payment ID.");
          return res.redirect("/editor/projects/pending");
        }
        const refund = await refundViaRazorpay(order, shop);
        console.log("Razorpay refund successful:", refund.id);
      } else if (gateway === "phonepe") {
        if (!order.transactionId || !order.gatewayTxnId) {
          order.refundStatus = "failed";
          await order.save();
          req.flash("error", "Invalid payment ID.");
          return res.redirect("/editor/projects/pending");
        }
        const result = await refundViaPhonePe(order, shop);
        console.log("PhonePe refund response:", result?.code || result);
      } else {
        order.refundStatus = "failed";
        await order.save();
        req.flash("error", "Refunds not supported for this payment method.");
        return res.redirect("/editor/projects/pending");
      }

      order.status = "cancelled";
      order.refundStatus = "completed";
      await order.save();
      emitPendingCount(order.shop);

      req.flash("success", "Project cancelled and refund initiated.");
      return res.redirect("/editor/projects/pending");
    } catch (error) {
      console.error("REFUND ERROR:", error);
      if (error?.error) {
        console.error(error.error);
      }
      if (order) {
        order.refundStatus = "failed";
        await order.save();
      }
      req.flash("error", "Refund failed. Please process manually from the payment dashboard.");
      return res.redirect("/editor/projects/pending");
    }
  },
);

editorRouter.get(
  "/editor/projects/completed",
  requireDb,
  requireAuth,
  requireEditor,
  requireVendorShop,
  async (req, res) => {
    const orders = await Order.find({
      shop: req.vendorShopId,
      status: { $in: ["completed", "cancelled"] },
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    res.render("vendor/completed-orders", {
      pageTitle: "Completed & Cancelled Projects",
      orders,
    });
  },
);

editorRouter.get(
  "/editor/projects/:id",
  requireDb,
  requireAuth,
  requireEditor,
  requireVendorShop,
  async (req, res) => {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      req.flash("error", "Project not found.");
      return res.redirect("/editor/projects/pending");
    }

    const order = await Order.findById(id)
      .populate("customer", "name email")
      .populate("shop", "name slug")
      .lean();

    if (!order || String(order.shop?._id || order.shop) !== req.vendorShopIdStr) {
      req.flash("error", "Project not found.");
      return res.redirect("/editor/projects/pending");
    }

    const referrer = req.get("Referrer");
    let backHref = "/editor/projects/pending";
    if (referrer) {
      try {
        const referrerUrl = new URL(referrer);
        if (referrerUrl.host === req.get("host")) {
          backHref = `${referrerUrl.pathname}${referrerUrl.search}`;
        }
      } catch {
        if (referrer.startsWith("/")) {
          backHref = referrer;
        }
      }
    }

    res.render("vendor/order-details", {
      pageTitle: `Project #${String(order._id).slice(-6).toUpperCase()}`,
      order,
      backHref,
    });
  },
);

editorRouter.get(
  "/editor/projects/:id/adjust",
  requireDb,
  requireAuth,
  requireEditor,
  requireVendorShop,
  async (req, res) => {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      req.flash("error", "Invalid project.");
      return res.redirect("/editor/projects/pending");
    }

    const order = await Order.findById(id)
      .populate("customer", "name email")
      .lean();

    if (!order || String(order.shop?._id || order.shop) !== req.vendorShopIdStr) {
      req.flash("error", "Project not found.");
      return res.redirect("/editor/projects/pending");
    }

    if (!["pending", "assigned", "in_progress"].includes(order.status)) {
      req.flash("error", "This project cannot be adjusted.");
      return res.redirect("/editor/projects/pending");
    }

    res.render("vendor/adjust-order", {
      pageTitle: `Adjust Project #${String(order._id).slice(-6).toUpperCase()}`,
      order,
    });
  },
);

editorRouter.post(
  "/editor/projects/:id/adjust",
  requireDb,
  requireAuth,
  requireEditor,
  requireVendorShop,
  async (req, res) => {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      req.flash("error", "Invalid project.");
      return res.redirect("/editor/projects/pending");
    }

    const order = await Order.findById(id);
    if (!order || String(order.shop) !== req.vendorShopIdStr) {
      req.flash("error", "Project not found.");
      return res.redirect("/editor/projects/pending");
    }

    if (!["pending", "assigned", "in_progress"].includes(order.status)) {
      req.flash("error", "This project cannot be adjusted.");
      return res.redirect("/editor/projects/pending");
    }

    const rawKeep = req.body.keep_items;
    const keepArr = Array.isArray(rawKeep) ? rawKeep : [rawKeep].filter(Boolean);
    const keepIndices = keepArr
      .map((v) => parseInt(v, 10))
      .filter((n) => !isNaN(n) && n >= 0);

    const adjustmentReason = String(req.body.adjustmentReason || "").trim();
    if (!adjustmentReason) {
      req.flash("error", "Please select a reason for the adjustment.");
      return res.redirect(`/editor/projects/${id}/adjust`);
    }

    if (keepIndices.length === 0) {
      req.flash("error", "All items would be removed. Use Cancel instead.");
      return res.redirect(`/editor/projects/${id}/adjust`);
    }

    if (keepIndices.length === order.items.length) {
      req.flash("error", "No items were removed. No adjustment needed.");
      return res.redirect(`/editor/projects/${id}/adjust`);
    }

    let originalTotal = Number(order.total);
    let updatedTotal = 0;

    for (let i = 0; i < order.items.length; i++) {
      const item = order.items[i];
      if (keepIndices.includes(i)) {
        item.status = "active";
        updatedTotal += Number(item.price) * Number(item.quantity);
      } else {
        item.status = "removed";
      }
    }

    const refundAmount = originalTotal - updatedTotal;

    order.originalTotal = originalTotal;
    order.updatedTotal = updatedTotal;
    order.refundAmount = refundAmount;
    order.total = updatedTotal;
    order.adjustedAt = new Date();
    order.adjustedBy = req.user._id;
    order.adjustmentReason = adjustmentReason;
    order.refundStatus = "none";

    if (refundAmount > 0) {
      const shop = await Shop.findById(req.vendorShopId)
        .select("paymentGateway paymentConfigured paymentSettings")
        .lean();

      const gateway = shop?.paymentGateway || "razorpay";

      if (order.paymentNote === "mock") {
        order.refundStatus = "completed";
      } else {
        try {
          if (gateway === "razorpay") {
            if (!order.razorpayPaymentId) throw new Error("Invalid payment ID for partial refund.");
            const refund = await partialRefundViaRazorpay(order, shop, refundAmount);
            console.log("Razorpay partial refund successful:", refund.id);
            order.refundStatus = "completed";
          } else if (gateway === "phonepe") {
            if (!order.transactionId || !order.gatewayTxnId) throw new Error("Invalid payment ID for partial refund.");
            const result = await partialRefundViaPhonePe(order, shop, refundAmount);
            console.log("PhonePe partial refund response:", result?.code || result);
            order.refundStatus = "completed";
          } else {
            order.refundStatus = "pending";
          }
        } catch (err) {
          console.error("Partial refund error:", err);
          order.refundStatus = "pending";
        }
      }
    } else {
      order.refundStatus = "completed";
    }

    await order.save();

    if (order.refundStatus === "pending") {
      req.flash("error", "Project adjusted but refund could not be processed automatically. Please process manually from the payment dashboard.");
    } else {
      req.flash("success", `Project adjusted. Refund of ₹${refundAmount.toFixed(2)} processed.`);
    }
    return res.redirect("/editor/projects/pending");
  },
);

editorRouter.get(
  "/editor/payment/settings",
  requireDb,
  requireAuth,
  requireEditor,
  requireVendorShop,
  async (req, res) => {
    try {
      const shop = await Shop.findById(req.vendorShopId).lean();
      if (!shop) {
        req.flash("error", "Workspace not found.");
        return res.redirect("/editor/assets");
      }

      res.render("vendor/payment-settings", {
        pageTitle: "Payment Settings",
        shop,
      });
    } catch (err) {
      console.error("Error fetching payment settings:", err);
      req.flash("error", "Failed to load payment settings.");
      return res.redirect("/editor/assets");
    }
  },
);

editorRouter.post(
  "/editor/payment/settings",
  requireDb,
  requireAuth,
  requireEditor,
  requireVendorShop,
  async (req, res) => {
    try {
      const {
        paymentGateway,
        razorpayKeyId, razorpayKeySecret,
        easebuzzMerchantKey, easebuzzSalt, easebuzzEnv,
        phonepeClientId, phonepeClientSecret, phonepeClientVersion, phonepeEnv,
      } = req.body;

      const shop = await Shop.findById(req.vendorShopId);
      if (!shop) {
        req.flash("error", "Workspace not found.");
        return res.redirect("/editor/payment/settings");
      }

      if (paymentGateway !== undefined) {
        if (!["razorpay", "easebuzz", "phonepe", "paytm", "bharatpe"].includes(paymentGateway)) {
          req.flash("error", "Invalid payment gateway.");
          return res.redirect("/editor/payment/settings");
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
      return res.redirect("/editor/payment/settings");
    } catch (err) {
      console.error("Error updating payment settings:", err);
      req.flash("error", "Failed to save payment settings.");
      return res.redirect("/editor/payment/settings");
    }
  },
);
