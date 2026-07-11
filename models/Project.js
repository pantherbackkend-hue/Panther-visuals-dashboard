import mongoose from "mongoose";

const timelineEntrySchema = new mongoose.Schema(
  {
    action: {
      type: String,
      enum: [
        "Project Created",
        "Assigned",
        "Accepted",
        "Rejected",
        "Working",
        "Submitted",
        "Revision Requested",
        "Revision Completed",
        "Approved",
        "Paid",
        "Archived",
        "Updated",
      ],
      required: true,
    },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    userName: { type: String, default: "" },
    previousStatus: { type: String, default: "" },
    newStatus: { type: String, default: "" },
    notes: { type: String, default: "" },
  },
  { timestamps: true },
);

const revisionEntrySchema = new mongoose.Schema(
  {
    revisionNumber: { type: Number, required: true },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    notes: { type: String, default: "" },
    completedAt: { type: Date },
  },
  { timestamps: true },
);

const projectSchema = new mongoose.Schema(
  {
    clientName: { type: String, required: true, trim: true },
    projectName: { type: String, required: true, trim: true },
    assignedEditor: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    driveLink: { type: String, default: "" },
    priority: {
      type: String,
      enum: ["low", "medium", "high", "urgent"],
      default: "medium",
    },
    dueDate: { type: Date, default: null },
    notes: { type: String, default: "" },
    paymentAmount: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: [
        "new_project",
        "pending_assignment",
        "assigned",
        "accepted_by_editor",
        "working",
        "revision_1",
        "revision_2",
        "revision_3",
        "completed",
        "waiting_for_payment",
        "paid",
        "archived",
      ],
      default: "new_project",
    },
    revisionCounter: { type: Number, default: 0 },
    activityTimeline: { type: [timelineEntrySchema], default: [] },
    revisionHistory: { type: [revisionEntrySchema], default: [] },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

projectSchema.index({ status: 1 });
projectSchema.index({ assignedEditor: 1, status: 1 });
projectSchema.index({ priority: 1, createdAt: -1 });

export const Project = mongoose.model("Project", projectSchema);
