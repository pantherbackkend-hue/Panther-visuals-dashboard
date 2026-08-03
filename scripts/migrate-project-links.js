import mongoose from "mongoose";
import dotenv from "dotenv";
import { Project } from "../models/Project.js";

dotenv.config();

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!uri) {
  console.error("MONGODB_URI or MONGO_URI must be set in .env");
  process.exit(1);
}

async function migrateProjectLinks() {
  await mongoose.connect(uri);
  console.log(`Connected: ${mongoose.connection.host}\n`);

  const summary = {
    totalProjects: 0,
    migrated: 0,
    alreadyMigrated: 0,
    errors: 0,
  };

  const projects = await Project.find()
    .select("_id projectName driveLink assetsFolderLink projectFilesLink")
    .lean();

  console.log(`Found ${projects.length} projects to process.\n`);

  for (const project of projects) {
    summary.totalProjects++;

    // Projects that already went through the migration (assetsFolderLink is
    // present and the legacy driveLink has been unset) are skipped, making the
    // script safe to run multiple times.
    if (!project.driveLink && project.assetsFolderLink !== undefined) {
      summary.alreadyMigrated++;
      continue;
    }

    const oldLink = project.driveLink || "";
    const update = {
      $set: {
        assetsFolderLink: oldLink,
        projectFilesLink: project.projectFilesLink || "",
      },
      $unset: { driveLink: 1 },
    };

    try {
      await Project.updateOne({ _id: project._id }, update);
      summary.migrated++;
      if (oldLink) {
        console.log(
          `  [${project._id.toString().slice(-6)}] "${project.projectName}" -> assetsFolderLink: "${oldLink}"`
        );
      } else {
        console.log(
          `  [${project._id.toString().slice(-6)}] "${project.projectName}" -> no legacy driveLink, normalized`
        );
      }
    } catch (err) {
      summary.errors++;
      console.error(`  [${project._id.toString().slice(-6)}] FAILED: ${err.message}`);
    }
  }

  console.log("\n=== Migration Summary ===");
  console.log(`Total projects processed: ${summary.totalProjects}`);
  console.log(`Migrated (driveLink -> assetsFolderLink): ${summary.migrated}`);
  console.log(`Already migrated:         ${summary.alreadyMigrated}`);
  console.log(`Errors:                   ${summary.errors}`);

  const remainingLegacy = await Project.countDocuments({ driveLink: { $exists: true } });
  const withAssetsLink = await Project.countDocuments({ assetsFolderLink: { $ne: "", $exists: true } });
  const withFilesLink = await Project.countDocuments({ projectFilesLink: { $ne: "", $exists: true } });
  console.log(`\nProjects still carrying legacy driveLink: ${remainingLegacy}`);
  console.log(`Projects with assetsFolderLink set:     ${withAssetsLink}`);
  console.log(`Projects with projectFilesLink set:     ${withFilesLink}`);

  await mongoose.disconnect();
  console.log("\nMigration complete.");
}

migrateProjectLinks().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
