import mongoose from "mongoose";
import dotenv from "dotenv";
import { Project } from "../models/Project.js";

dotenv.config();

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!uri) {
  console.error("MONGODB_URI or MONGO_URI must be set in .env");
  process.exit(1);
}

async function migrateEditorAmount() {
  await mongoose.connect(uri);
  console.log(`Connected: ${mongoose.connection.host}\n`);

  const summary = {
    totalProjects: 0,
    updated: 0,
    alreadySet: 0,
    skipped: 0,
  };

  const projects = await Project.find().lean();
  console.log(`Found ${projects.length} projects to process.\n`);

  for (const project of projects) {
    summary.totalProjects++;

    const current = Number(project.editorAmount || 0);
    const legacy = Number(project.payment?.editorAmount || 0);

    if (current === legacy) {
      summary.skipped++;
      continue;
    }

    await Project.updateOne(
      { _id: project._id },
      { $set: { editorAmount: legacy } }
    );

    summary.updated++;
    console.log(
      `  [${project._id.toString().slice(-6)}] "${project.projectName}" -> editorAmount: ${legacy} (from payment.editorAmount)`
    );
  }

  console.log("\n=== Migration Summary ===");
  console.log(`Total projects processed: ${summary.totalProjects}`);
  console.log(`Updated:                 ${summary.updated}`);
  console.log(`Already in sync:         ${summary.skipped}`);

  await mongoose.disconnect();
  console.log("\nMigration complete.");
}

migrateEditorAmount().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
