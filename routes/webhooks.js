import express from "express";
import crypto from "crypto";
import { Order } from "../models/Order.js";
import { Shop } from "../models/Shop.js";
import { requireDb } from "../middleware/requireDb.js";
import { getWebhookSecretFromShop } from "../config/razorpay.js";
import { emitPendingCount } from "../socket/index.js";

export const webhooksRouter = express.Router();

function signaturesMatch(expectedHex, actualHex) {
  if (!expectedHex || !actualHex) return false;
  const a = Buffer.from(expectedHex, "utf8");
  const b = Buffer.from(actualHex, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

webhooksRouter.post(
  "/webhooks/razorpay",
  express.raw({ type: "application/json" }),
  requireDb,
  async (req, res) => {
    try {
      const signature = req.get("x-razorpay-signature");
      const eventId = req.get("x-razorpay-event-id") || "";
      const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || "");

      if (!signature) {
        return res.status(400).json({ error: "Missing signature" });
      }

      let event;
      try {
        event = JSON.parse(rawBody.toString("utf8"));
      } catch {
        return res.status(400).json({ error: "Invalid JSON" });
      }

      const paymentEntity = event?.payload?.payment?.entity || {};
      const razorpayOrderId = paymentEntity.order_id;
      const razorpayPaymentId = paymentEntity.id;

      const order = razorpayOrderId ? await Order.findOne({ razorpayOrderId }) : null;

      if (!order) {
        return res.status(200).json({ received: true, ignored: true });
      }

      const shop = await Shop.findById(order.shop)
        .select("paymentConfigured paymentSettings")
        .lean();
      const webhookSecret = getWebhookSecretFromShop(shop);

      if (!webhookSecret) {
        console.error("Razorpay webhook secret not configured.");
        return res.status(500).json({ error: "Webhook not configured" });
      }

      const expected = crypto
        .createHmac("sha256", webhookSecret)
        .update(rawBody)
        .digest("hex");

      if (!signaturesMatch(expected, signature)) {
        return res.status(400).json({ error: "Invalid signature" });
      }

      if (eventId && order.webhookEventId === eventId) {
        return res.status(200).json({ received: true, duplicate: true });
      }

      const eventType = event?.event;

      if (eventType === "payment.captured") {
        const updated = await Order.findOneAndUpdate(
          { razorpayOrderId, status: "pending_payment" },
          {
            $set: {
              status: "pending",
              paymentNote: razorpayPaymentId,
              transactionId: razorpayPaymentId,
              razorpayPaymentId,
              webhookEventId: eventId,
            },
          },
          { new: true }
        );

        if (updated) {
          emitPendingCount(order.shop);
        }

        if (!updated && eventId) {
          await Order.updateOne(
            { razorpayOrderId },
            { $set: { webhookEventId: eventId } }
          );
        }
      } else if (eventType === "payment.failed") {
        await Order.findOneAndUpdate(
          { razorpayOrderId, status: "pending_payment" },
          {
            $set: {
              status: "cancelled",
              paymentNote: razorpayPaymentId || "failed",
              razorpayPaymentId: razorpayPaymentId || "",
              webhookEventId: eventId,
            },
          }
        );

        if (eventId) {
          await Order.updateOne(
            { razorpayOrderId, webhookEventId: { $ne: eventId } },
            { $set: { webhookEventId: eventId } }
          );
        }
      }

      return res.status(200).json({ received: true });
    } catch (err) {
      console.error("Razorpay webhook error:", err);
      return res.status(500).json({ error: "Webhook processing failed" });
    }
  }
);
