import mongoose from "mongoose";
import dotenv from "dotenv";
import { Project } from "../models/Project.js";
import { Client } from "../models/Client.js";

dotenv.config();

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!uri) {
  console.error("MONGODB_URI or MONGO_URI must be set in .env");
  process.exit(1);
}

async function migrate() {
  await mongoose.connect(uri);
  console.log(`Connected: ${mongoose.connection.host}\n`);

  const summary = { clientsCreated: 0, projectsLinked: 0, duplicatesMerged: 0, skipped: 0 };

  const projects = await Project.find({
    clientRef: null,
    "client.name": { $ne: "", $exists: true },
  }).lean();

  if (projects.length === 0) {
    console.log("No unlinked projects found. Nothing to do.");
    await mongoose.disconnect();
    return;
  }

  const groups = {};
  for (const p of projects) {
    const key = p.client.name.trim().toLowerCase();
    if (!groups[key]) groups[key] = [];
    groups[key].push(p);
  }

  for (const [key, group] of Object.entries(groups)) {
    const displayName = group[0].client.name.trim();

    let client = await Client.findOne({
      name: { $regex: `^${escapeRegex(displayName)}$`, $options: "i" },
    });

    if (client) {
      summary.duplicatesMerged += group.length - 1;
    } else {
      const src = group[0].client;
      client = await Client.create({
        name: displayName,
        email: src.email?.trim().toLowerCase() || "",
        notes: src.notes || "",
        createdBy: group[0].createdBy || undefined,
      });
      summary.clientsCreated++;
    }

    for (const p of group) {
      if (String(client._id) === String(p.clientRef)) {
        summary.skipped++;
        continue;
      }
      await Project.updateOne({ _id: p._id }, { $set: { clientRef: client._id } });
      summary.projectsLinked++;
    }
  }

  console.log("=== Migration Summary ===");
  console.log(`Clients created:     ${summary.clientsCreated}`);
  console.log(`Projects linked:     ${summary.projectsLinked}`);
  console.log(`Duplicates merged:   ${summary.duplicatesMerged}`);
  console.log(`Skipped (already linked): ${summary.skipped}`);
  console.log("");

  const totalClients = await Client.countDocuments();
  const linkedProjects = await Project.countDocuments({ clientRef: { $ne: null } });
  const unlinkedProjects = await Project.countDocuments({
    clientRef: null,
    "client.name": { $ne: "", $exists: true },
  });
  console.log(`Total Clients:       ${totalClients}`);
  console.log(`Total Linked Proj:   ${linkedProjects}`);
  console.log(`Remaining Unlinked:  ${unlinkedProjects}`);

  await mongoose.disconnect();
}

function escapeRegex(str) {
  return str.replace(/[/\-\\^$*+?.()|[\]{}]/g, "\\$&");
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
