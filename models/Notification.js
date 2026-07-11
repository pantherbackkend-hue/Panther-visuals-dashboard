import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    recipientRole: { type: String, enum: ["admin", "editor", "client", "owner"], default: null },
    project: { type: mongoose.Schema.Types.ObjectId, ref: "Project" },
    title: { type: String, required: true },
    message: { type: String, default: "" },
    type: {
      type: String,
      enum: [
        "project_created",
        "project_assigned",
        "project_accepted",
        "project_rejected",
        "working",
        "submitted",
        "revision_requested",
        "revision_completed",
        "approved",
        "paid",
        "archived",
        "status_change",
        "assignment_blocked",
      ],
      required: true,
    },
    read: { type: Boolean, default: false },
    readAt: { type: Date, default: null },
    actionUrl: { type: String, default: "" },
    channel: { type: String, enum: ["in_app", "email", "whatsapp"], default: "in_app" },
    externalId: { type: String, default: null },
    deliveredAt: { type: Date, default: null },
  },
  { timestamps: true },
);

notificationSchema.index({ recipient: 1, read: 1, createdAt: -1 });
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

export const Notification = mongoose.model("Notification", notificationSchema);
