import mongoose from "mongoose";

const clientSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, default: "", trim: true },
  phone: { type: String, default: "", trim: true },
  notes: { type: String, default: "" },
}, { _id: false });

const submissionSchema = new mongoose.Schema({
  version: { type: Number, required: true },
  driveLink: { type: String, default: "" },
  description: { type: String, default: "" },
  submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  submittedAt: { type: Date, default: Date.now },
}, { _id: true });

const feedbackSchema = new mongoose.Schema({
  versionRef: { type: Number, default: null },
  comment: { type: String, default: "" },
  driveLink: { type: String, default: "" },
  timestamp: { type: String, default: "" },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  createdAt: { type: Date, default: Date.now },
}, { _id: true });

const paymentSchema = new mongoose.Schema({
  amount: { type: Number, default: 0, min: 0 },
  clientAmount: { type: Number, default: 0, min: 0 },
  editorAmount: { type: Number, default: 0, min: 0 },
  status: { type: String, enum: ["pending", "paid"], default: "pending" },
  paidAt: { type: Date, default: null },
  paidBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  upiId: { type: String, default: "" },
}, { _id: false });

const timelineEntrySchema = new mongoose.Schema(
  {
    action: {
      type: String,
      enum: [
        "Project Created",
        "Assigned",
        "Accepted",
        "Submission Uploaded",
        "Feedback Added",
        "Completed",
        "Payment Done",
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

const projectSchema = new mongoose.Schema(
  {
    client: { type: clientSchema, default: () => ({ name: "" }) },
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
    status: {
      type: String,
      enum: [
        "pending_assignment",
        "assigned",
        "ongoing",
        "submitted",
        "completed",
      ],
      default: "pending_assignment",
    },
    submissions: { type: [submissionSchema], default: [] },
    feedback: { type: [feedbackSchema], default: [] },
    payment: { type: paymentSchema, default: () => ({}) },
    activityTimeline: { type: [timelineEntrySchema], default: [] },
    ownerAssignment: { type: String, enum: ["admin", "direct", null], default: null },
    ownerAdmin: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

projectSchema.index({ status: 1 });
projectSchema.index({ assignedEditor: 1, status: 1 });
projectSchema.index({ priority: 1, createdAt: -1 });

export const Project = mongoose.model("Project", projectSchema);
