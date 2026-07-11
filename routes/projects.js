import express from "express";
import crypto from "crypto";
import mongoose from "mongoose";
import { Order } from "../models/Order.js";
import { Shop } from "../models/Shop.js";
import { requireDb } from "../middleware/requireDb.js";
import { requireAuth, requireClient } from "../middleware/auth.js";
import { createRazorpayFromShop } from "../config/razorpay.js";
import {
  getEasebuzzFromShop,
  buildPaymentHash,
  verifyResponseHash,
  initiatePayment as easebuzzInitiatePayment,
  easebuzzPayUrl,
} from "../config/easebuzz.js";
import {
  getPhonepeFromShop,
  getAuthToken,
  createPayment,
  getOrderStatus,
} from "../config/phonepe.js";
import { emitPendingCount } from "../socket/index.js";

export const projectsRouter = express.Router();

projectsRouter.get(
  "/projects",
  requireDb,
  requireAuth,
  requireClient,
  async (req, res) => {
    const projects = await Order.find({ customer: req.session.userId })
      .sort({ createdAt: -1 })
      .populate("shop", "name slug")
      .lean();
    res.render("orders/index", { pageTitle: "My Projects", orders: projects });
  },
);

projectsRouter.get(
  "/projects/:id",
  requireDb,
  requireAuth,
  requireClient,
  async (req, res) => {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      req.flash("error", "Project not found.");
      return res.redirect("/projects");
    }
    const order = await Order.findById(id).populate("shop", "name slug").lean();
    if (!order || String(order.customer) !== String(req.session.userId)) {
      req.flash("error", "Project not found.");
      return res.redirect("/projects");
    }
    res.render("orders/show", {
      pageTitle: `Project #${String(order._id).slice(-6)}`,
      order,
    });
  },
);

projectsRouter.get(
  "/api/projects/:id/status",
  requireDb,
  requireAuth,
  requireClient,
  async (req, res) => {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(404).json({ error: "Project not found." });
    }

    const order = await Order.findById(id).select("customer status adjustedAt refundAmount").lean();
    if (!order || String(order.customer) !== String(req.session.userId)) {
      return res.status(404).json({ error: "Project not found." });
    }

    const adjusted = !!(order.adjustedAt);
    return res.json({
      status: order.status,
      adjusted,
      refundAmount: adjusted ? (order.refundAmount || 0) : undefined,
    });
  },
);

// --- Razorpay payment flow ---
projectsRouter.post(
  "/create-razorpay-order",
  requireDb,
  requireAuth,
  requireClient,
  async (req, res) => {
    try {
      const { amount, workspaceId } = req.body;
      if (!amount || !workspaceId) {
        return res.status(400).json({ error: "Amount and workspace are required." });
      }

      const shop = await Shop.findById(workspaceId).lean();
      if (!shop || shop.isActive === false) {
        return res.status(400).json({ error: "Workspace not found or disabled." });
      }
      if (shop.paymentGateway !== "razorpay") {
        return res.status(400).json({ error: "This workspace is not using Razorpay." });
      }

      const { keyId, instance } = createRazorpayFromShop(shop);

      const rzpOrder = await instance.orders.create({
        amount: Math.round(Number(amount) * 100),
        currency: "INR",
        receipt: `receipt_${Date.now()}`,
      });

      await Order.create({
        customer: req.session.userId,
        shop: workspaceId,
        total: Number(amount),
        status: "pending_payment",
        transactionId: "",
        razorpayOrderId: rzpOrder.id,
      });

      res.json({ ...rzpOrder, key_id: keyId });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to create Razorpay order" });
    }
  },
);

projectsRouter.post(
  "/verify-payment",
  requireDb,
  requireAuth,
  requireClient,
  async (req, res) => {
    try {
      const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

      const sign = razorpay_order_id + "|" + razorpay_payment_id;

      const order = await Order.findOne({ razorpayOrderId: razorpay_order_id });
      if (!order || String(order.customer) !== String(req.session.userId)) {
        return res.status(404).json({ success: false, message: "Project not found." });
      }

      const paymentShop = await Shop.findById(order.shop)
        .select("paymentGateway paymentConfigured paymentSettings")
        .lean();

      const { keySecret } = createRazorpayFromShop(paymentShop);

      const expectedSign = crypto
        .createHmac("sha256", keySecret)
        .update(sign.toString())
        .digest("hex");

      const isAuthentic = expectedSign === razorpay_signature;
      if (!isAuthentic) {
        return res.status(400).json({ success: false, message: "Invalid payment signature" });
      }

      if (order.status === "pending_payment") {
        order.status = "pending";
        order.paymentNote = razorpay_payment_id;
        order.transactionId = razorpay_payment_id;
        order.razorpayPaymentId = razorpay_payment_id;
        await order.save();

        emitPendingCount(order.shop);
      }

      return res.json({ success: true, orderId: order._id });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: "Payment verification failed" });
    }
  },
);

// --- Easebuzz hosted checkout ---
projectsRouter.post(
  "/easebuzz/initiate",
  requireDb,
  requireAuth,
  requireClient,
  async (req, res) => {
    try {
      const { amount, workspaceId } = req.body;
      if (!amount || !workspaceId) {
        return res.status(400).json({ error: "Amount and workspace are required." });
      }

      const shop = await Shop.findById(workspaceId).lean();
      if (!shop || shop.isActive === false) {
        return res.status(400).json({ error: "Workspace not found or disabled." });
      }
      if (shop.paymentGateway !== "easebuzz") {
        return res.status(400).json({ error: "This workspace is not using Easebuzz." });
      }

      const { merchantKey, salt, baseUrl } = getEasebuzzFromShop(shop);
      if (!merchantKey || !salt) {
        return res.status(500).json({ error: "Easebuzz is not configured for this workspace." });
      }

      const user = req.user || {};
      const amountFormatted = Number(amount).toFixed(2);
      const txnid = new mongoose.Types.ObjectId().toString();
      const productinfo = `Panther Visuals project - ${shop.name}`;
      const firstname = String(user.name || "Client").slice(0, 60);
      const email = String(user.email || "client@panthervisuals.local");

      await Order.create({
        customer: req.session.userId,
        shop: workspaceId,
        total: Number(amount),
        status: "pending_payment",
        transactionId: "",
        gatewayTxnId: txnid,
      });

      const hash = buildPaymentHash({
        merchantKey, salt, txnid,
        amount: amountFormatted,
        productinfo, firstname, email,
      });

      const origin = `${req.protocol}://${req.get("host")}`;
      const params = {
        key: merchantKey, txnid, amount: amountFormatted,
        productinfo, firstname, email,
        phone: "9999999999",
        surl: `${origin}/easebuzz/callback`,
        furl: `${origin}/easebuzz/callback`,
        hash,
      };

      const result = await easebuzzInitiatePayment(params, baseUrl);
      if (!result || Number(result.status) !== 1 || !result.data) {
        console.error("Easebuzz initiateLink rejected:", result?.data || result);
        return res.status(502).json({
          error: typeof result?.data === "string" ? result.data : "Easebuzz declined the payment request.",
        });
      }

      return res.json({ redirectUrl: easebuzzPayUrl(baseUrl, result.data) });
    } catch (err) {
      console.error("Easebuzz initiate failed:", err);
      return res.status(500).json({ error: "Failed to initiate Easebuzz payment" });
    }
  },
);

projectsRouter.post("/easebuzz/callback", requireDb, async (req, res) => {
  try {
    const payload = req.body || {};
    const txnid = payload.txnid;

    const order = txnid ? await Order.findOne({ gatewayTxnId: txnid }) : null;
    if (!order) {
      req.flash?.("error", "Payment could not be matched to a project.");
      return res.redirect("/projects");
    }

    const shop = await Shop.findById(order.shop)
      .select("paymentSettings paymentGateway")
      .lean();
    const { merchantKey, salt } = getEasebuzzFromShop(shop);

    const valid = verifyResponseHash({ merchantKey, salt, payload });
    if (!valid) {
      return res.redirect(`/projects/${order._id}`);
    }

    if (order.status === "pending_payment") {
      const success = String(payload.status).toLowerCase() === "success";
      order.status = success ? "pending" : "cancelled";
      order.paymentNote = payload.easepayid || payload.status || "easebuzz";
      order.transactionId = payload.easepayid || "";
      await order.save();

      if (success) emitPendingCount(order.shop);
    }

    return res.redirect(`/projects/${order._id}`);
  } catch (err) {
    console.error("Easebuzz callback failed:", err);
    return res.redirect("/projects");
  }
});

// --- PhonePe hosted checkout ---
projectsRouter.post(
  "/phonepe/initiate",
  requireDb,
  requireAuth,
  requireClient,
  async (req, res) => {
    try {
      const { amount, workspaceId } = req.body;
      if (!amount || !workspaceId) {
        return res.status(400).json({ error: "Amount and workspace are required." });
      }

      const shop = await Shop.findById(workspaceId).lean();
      if (!shop || shop.isActive === false) {
        return res.status(400).json({ error: "Workspace not found or disabled." });
      }
      if (shop.paymentGateway !== "phonepe") {
        return res.status(400).json({ error: "This workspace is not using PhonePe." });
      }

      const phonepe = getPhonepeFromShop(shop);
      if (!phonepe.clientId || !phonepe.clientSecret) {
        return res.status(500).json({ error: "PhonePe is not configured for this workspace." });
      }

      const user = req.user || {};
      const txnid = new mongoose.Types.ObjectId().toString();
      const origin = `${req.protocol}://${req.get("host")}`;

      const auth = await getAuthToken({
        clientId: phonepe.clientId,
        clientSecret: phonepe.clientSecret,
        clientVersion: phonepe.clientVersion,
        env: phonepe.env,
      });

      if (!auth || !auth.access_token) {
        console.error("PhonePe auth rejected:", auth);
        return res.status(502).json({
          error: auth?.message || "Failed to authenticate with PhonePe.",
        });
      }

      await Order.create({
        customer: req.session.userId,
        shop: workspaceId,
        total: Number(amount),
        status: "pending_payment",
        transactionId: "",
        gatewayTxnId: txnid,
      });

      const result = await createPayment({
        accessToken: auth.access_token,
        merchantTransactionId: txnid,
        amount: Number(amount),
        redirectUrl: `${origin}/phonepe/callback?merchantOrderId=${txnid}`,
        env: phonepe.env,
      });

      const redirectUrl = result?.redirectUrl;
      if (!redirectUrl) {
        console.error("PhonePe pay rejected:", result?.message || result);
        return res.status(502).json({
          error: result?.message || "PhonePe declined the payment request.",
        });
      }

      return res.json({ redirectUrl });
    } catch (err) {
      console.error("PhonePe initiate failed:", err);
      return res.status(500).json({ error: "Failed to initiate PhonePe payment" });
    }
  },
);

projectsRouter.all("/phonepe/callback", requireDb, async (req, res) => {
  try {
    const merchantOrderId = req.query.merchantOrderId || "";

    if (!merchantOrderId) {
      console.error("PhonePe callback missing merchantOrderId in query");
      req.flash("error", "PhonePe callback missing order reference.");
      return res.redirect("/projects");
    }

    const order = await Order.findOne({ gatewayTxnId: merchantOrderId });
    if (!order) {
      console.error("PhonePe callback: no order for", merchantOrderId);
      req.flash("error", "Project not found for this payment.");
      return res.redirect("/projects");
    }

    if (order.status !== "pending_payment") {
      return res.redirect(`/projects/${order._id}`);
    }

    const shop = await Shop.findById(order.shop)
      .select("paymentSettings paymentGateway")
      .lean();

    const phonepe = getPhonepeFromShop(shop);
    const auth = await getAuthToken({
      clientId: phonepe.clientId,
      clientSecret: phonepe.clientSecret,
      clientVersion: phonepe.clientVersion,
      env: phonepe.env,
    });

    if (!auth || !auth.access_token) {
      console.error("PhonePe callback auth failed:", auth);
      req.flash("error", "Payment verification failed.");
      return res.redirect(`/projects/${order._id}`);
    }

    const statusResult = await getOrderStatus({
      merchantOrderId,
      accessToken: auth.access_token,
      env: phonepe.env,
    });
    const state = statusResult?.state || "";

    if (state === "COMPLETED") {
      const transactionId = statusResult?.paymentDetails?.[0]?.transactionId || "";
      order.status = "pending";
      order.paymentNote = "paid";
      order.transactionId = transactionId;
      await order.save();

      emitPendingCount(order.shop);

      req.flash("success", "Payment successful! Your project has been submitted.");
      return res.redirect(`/projects/${order._id}`);
    }

    if (["FAILED", "EXPIRED", "CANCELLED", "REVERSED"].includes(state)) {
      order.status = "cancelled";
      order.paymentNote = `phonepe_${state.toLowerCase()}`;
      await order.save();

      req.flash("error", `Payment was ${state.toLowerCase()}. Please try again.`);
      return res.redirect(`/projects/${order._id}`);
    }

    console.error("PhonePe unexpected state:", state, statusResult);
    req.flash("error", `Payment is in an unexpected state: ${state}. Please contact support.`);
    return res.redirect(`/projects/${order._id}`);
  } catch (err) {
    console.error("PhonePe callback error:", err);
    req.flash("error", "Failed to process payment callback.");
    return res.redirect("/projects");
  }
});
