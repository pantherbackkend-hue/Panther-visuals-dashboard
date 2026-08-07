import mongoose from "mongoose";
import dotenv from "dotenv";
import { Project } from "../models/Project.js";

dotenv.config();

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!uri) {
  console.error("MONGODB_URI or MONGO_URI must be set in .env");
  process.exit(1);
}

async function migratePaymentStatus() {
  await mongoose.connect(uri);
  console.log(`Connected: ${mongoose.connection.host}\n`);

  // Initialize both payouts as pending wherever they are missing.
  // Idempotent: run again and nothing changes.
  const result = await Project.updateMany(
    {
      $or: [
        { "payment.admin": { $exists: false } },
        { "payment.editor": { $exists: false } },
      ],
    },
    {
      $set: {
        "payment.admin": { status: "pending", paidAt: null, paidBy: null },
        "payment.editor": { status: "pending", paidAt: null, paidBy: null },
      },
    }
  );

  console.log(`Projects updated: ${result.modifiedCount}`);
  console.log(`Matched: ${result.matchedCount}`);

  const missing = await Project.countDocuments({
    $or: [
      { "payment.admin": { $exists: false } },
      { "payment.editor": { $exists: false } },
    ],
  });
  console.log(`Still missing a payout object: ${missing}`);

  await mongoose.disconnect();
  console.log("\nMigration complete.");
}

migratePaymentStatus().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
