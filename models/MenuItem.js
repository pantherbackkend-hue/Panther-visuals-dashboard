import mongoose from "mongoose";

const assetSchema = new mongoose.Schema(
  {
    shop: { type: mongoose.Schema.Types.ObjectId, ref: "Shop", required: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    price: { type: Number, required: true, min: 0 },
    image: { type: String, default: "" },
    available: { type: Boolean, default: true },
    category: { type: String, default: "" },
    fileType: { type: String, default: "" },
    tags: [{ type: String }],
  },
  { timestamps: true }
);

assetSchema.index({ shop: 1, name: 1 });

export const MenuItem = mongoose.model("MenuItem", assetSchema);
