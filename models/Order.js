import mongoose from "mongoose";

const projectItemSchema = new mongoose.Schema(
  {
    asset: { type: mongoose.Schema.Types.ObjectId, ref: "MenuItem" },
    name: { type: String, required: true },
    price: { type: Number, required: true },
    quantity: { type: Number, required: true, min: 1 },
    status: { type: String, enum: ["active", "removed"], default: "active" },
    variantName: { type: String, default: null },
    variantPrice: { type: Number, default: null },
  },
  { _id: false },
);

const projectSchema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    shop: { type: mongoose.Schema.Types.ObjectId, ref: "Shop", required: true },
    items: { type: [projectItemSchema], default: [] },
    total: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: ["pending_payment", "pending", "assigned", "in_progress", "review", "revision", "completed", "cancelled"],
      default: "pending",
    },
    paymentNote: { type: String, default: "pending" },
    transactionId: { type: String, default: "" },
    razorpayOrderId: { type: String },
    razorpayPaymentId: { type: String, default: "" },
    webhookEventId: { type: String, default: "" },
    gatewayTxnId: { type: String },
    deadline: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    refundStatus: { type: String, enum: ["none", "pending", "completed", "failed"], default: "none" },
    originalTotal: { type: Number },
    updatedTotal: { type: Number },
    refundAmount: { type: Number },
    adjustedAt: { type: Date },
    adjustedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    adjustmentReason: { type: String, enum: ["Scope Change", "Asset Issue", "Client Request", "Other"] },
    notes: { type: String, default: "" },
  },
  { timestamps: true },
);

projectSchema.index({ shop: 1, status: 1 });
projectSchema.index({ customer: 1, createdAt: -1 });
projectSchema.index({ shop: 1, deadline: 1, createdAt: 1 });
projectSchema.index({ razorpayOrderId: 1 }, { unique: true, sparse: true });
projectSchema.index({ gatewayTxnId: 1 }, { unique: true, sparse: true });

export const Order = mongoose.model("Order", projectSchema);
