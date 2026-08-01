import mongoose from "mongoose";
import dotenv from "dotenv";
import { Project } from "../models/Project.js";
import { User } from "../models/User.js";
import { normalizeField } from "../utils/admin.js";

dotenv.config();

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!uri) {
  console.error("MONGODB_URI or MONGO_URI must be set in .env");
  process.exit(1);
}

async function migrateProjectFields() {
  await mongoose.connect(uri);
  console.log(`Connected: ${mongoose.connection.host}\n`);

  const summary = {
    totalProjects: 0,
    withEditor: 0,
    withoutEditor: 0,
    updated: 0,
    skipped: 0,
    alreadyCorrect: 0,
    editorLookupErrors: 0,
  };

  // Fetch all projects with assignedEditor populated
  const projects = await Project.find()
    .populate("assignedEditor", "name specialization")
    .lean();

  console.log(`Found ${projects.length} projects to process.\n`);

  // Process each project
  for (const project of projects) {
    summary.totalProjects++;

    const hasEditor = project.assignedEditor && project.assignedEditor._id;
    const existingField = project.field || "";
    const editorSpecialization = hasEditor
      ? project.assignedEditor.specialization || ""
      : "";

    // If project already has a field value (already migrated), skip it
    // This makes the migration idempotent - running again won't change already-migrated data
    if (existingField && existingField.trim() !== "") {
      summary.skipped++;
      continue;
    }

    // For projects with assigned editor, use their specialization
    if (hasEditor && editorSpecialization) {
      const normalizedField = normalizeField(editorSpecialization);

      await Project.updateOne(
        { _id: project._id },
        { $set: { field: normalizedField } }
      );

      summary.updated++;
      console.log(
        `  [${project._id.toString().slice(-6)}] "${project.projectName}" -> Field: "${normalizedField}" (from editor: ${project.assignedEditor.name})`
      );
    } else {
      // Projects without assigned editor get empty field
      // They will show under "All" but not under any specific field chip
      summary.withEditor++;

      await Project.updateOne(
        { _id: project._id },
        { $set: { field: "" } }
      );

      summary.withoutEditor++;
    }
  }

  console.log("\n=== Migration Summary ===");
  console.log(`Total projects processed: ${summary.totalProjects}`);
  console.log(`Projects with editor:     ${summary.withEditor}`);
  console.log(`Projects without editor:  ${summary.withoutEditor}`);
  console.log(`Fields updated:           ${summary.updated}`);
  console.log(`Fields already set:       ${summary.skipped}`);
  console.log("");

  // Verify migration
  const projectsWithField = await Project.countDocuments({ field: { $ne: "", $exists: true } });
  const projectsWithoutField = await Project.countDocuments({
    $or: [
      { field: "" },
      { field: { $exists: false } },
    ],
  });

  console.log(`Projects with field set:  ${projectsWithField}`);
  console.log(`Projects without field:   ${projectsWithoutField}`);

  // Show sample of unique field values
  const uniqueFields = await Project.distinct("field");
  const nonEmptyFields = uniqueFields.filter((f) => f && f.trim() !== "");
  console.log(`\nUnique field values (${nonEmptyFields.length}):`);
  nonEmptyFields.sort().forEach((field) => {
    console.log(`  - "${field}"`);
  });

  await mongoose.disconnect();
  console.log("\nMigration complete.");
}

migrateProjectFields().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});