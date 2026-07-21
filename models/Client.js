import mongoose from "mongoose";

const driveLinkSchema = new mongoose.Schema({
  label: { type: String, default: "", trim: true },
  url: { type: String, default: "", trim: true },
  isDefault: { type: Boolean, default: false },
}, { timestamps: true });

const assetSchema = new mongoose.Schema({
  label: { type: String, default: "", trim: true },
  driveLink: { type: String, default: "", trim: true },
  description: { type: String, default: "", trim: true },
  isDefault: { type: Boolean, default: false },
}, { timestamps: true });

const clientSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    channelName: { type: String, default: "", trim: true },
    channelUrl: { type: String, default: "", trim: true },
    email: { type: String, default: "", trim: true, lowercase: true },
    notes: { type: String, default: "" },
    driveLinks: { type: [driveLinkSchema], default: [] },
    assets: { type: [assetSchema], default: [] },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

clientSchema.index({ name: 1 }, { unique: true, collation: { locale: "en", strength: 2 } });

export const Client = mongoose.model("Client", clientSchema);
