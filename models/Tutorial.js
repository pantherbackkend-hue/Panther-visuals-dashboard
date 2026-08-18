import mongoose from "mongoose";

const tutorialSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    category: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
    thumbnailUrl: { type: String, default: "", trim: true },
    videoUrl: { type: String, required: true, trim: true },
    displayOrder: { type: Number, default: 0 },
    published: { type: Boolean, default: false },
    requiredForOnboarding: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

tutorialSchema.index({ displayOrder: 1, createdAt: 1 });
tutorialSchema.index({ category: 1, published: 1 });

export const Tutorial = mongoose.model("Tutorial", tutorialSchema);
