import connectDb from "../config/db.js";
import { User } from "../models/User.js";
import { Project } from "../models/Project.js";
import { Client } from "../models/Client.js";
import { Notification } from "../models/Notification.js";
import { Tutorial } from "../models/Tutorial.js";

const TEST_EMAIL_DOMAIN = "@test.com";

async function cleanupTestData() {
  await connectDb();

  console.log("🔍 Finding test accounts...");

  // 1. Find all test users
  const testUsers = await User.find({ email: { $regex: `${TEST_EMAIL_DOMAIN}$` } }).lean();
  const testUserIds = testUsers.map((u) => u._id);

  if (testUserIds.length === 0) {
    console.log("✅ No test accounts found. Nothing to clean.");
    return { deleted: { users: 0, projects: 0, clients: 0, notifications: 0, tutorials: 0 } };
  }

  console.log(`📋 Found ${testUserIds.length} test user(s):`, testUsers.map((u) => u.email).join(", "));

  // 2. Find projects created by or assigned to test users
  const testProjects = await Project.find({
    $or: [
      { createdBy: { $in: testUserIds } },
      { assignedEditor: { $in: testUserIds } },
      { ownerAdmin: { $in: testUserIds } },
    ],
  }).lean();

  const testProjectIds = testProjects.map((p) => p._id);
  console.log(`📋 Found ${testProjectIds.length} test project(s)`);

  // 3. Find clients created by test users
  const testClients = await Client.find({ createdBy: { $in: testUserIds } }).lean();
  const testClientIds = testClients.map((c) => c._id);
  console.log(`📋 Found ${testClientIds.length} test client(s)`);

  // 4. Find notifications for test projects
  const testNotifications = await Notification.find({ project: { $in: testProjectIds } }).lean();
  console.log(`📋 Found ${testNotifications.length} test notification(s)`);

  // 5. Find tutorials created by test users
  const testTutorials = await Tutorial.find({ createdBy: { $in: testUserIds } }).lean();
  console.log(`📋 Found ${testTutorials.length} test tutorial(s)`);

  // 6. Perform deletions
  console.log("\n🗑️  Deleting test data...");

  const deletedProjects = await Project.deleteMany({ _id: { $in: testProjectIds } });
  console.log(`   ✅ Deleted ${deletedProjects.deletedCount} project(s)`);

  const deletedNotifications = await Notification.deleteMany({ project: { $in: testProjectIds } });
  console.log(`   ✅ Deleted ${deletedNotifications.deletedCount} notification(s)`);

  const deletedClients = await Client.deleteMany({ _id: { $in: testClientIds } });
  console.log(`   ✅ Deleted ${deletedClients.deletedCount} client(s)`);

  const deletedTutorials = await Tutorial.deleteMany({ createdBy: { $in: testUserIds } });
  console.log(`   ✅ Deleted ${deletedTutorials.deletedCount} tutorial(s)`);

  const deletedUsers = await User.deleteMany({ _id: { $in: testUserIds } });
  console.log(`   ✅ Deleted ${deletedUsers.deletedCount} user(s)`);

  console.log("\n✅ Cleanup complete!");

  return {
    deleted: {
      users: deletedUsers.deletedCount,
      projects: deletedProjects.deletedCount,
      clients: deletedClients.deletedCount,
      notifications: deletedNotifications.deletedCount,
      tutorials: deletedTutorials.deletedCount,
    },
  };
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  cleanupTestData()
    .then((result) => {
      console.log("\n📊 Summary:", result);
      process.exit(0);
    })
    .catch((err) => {
      console.error("❌ Cleanup failed:", err);
      process.exit(1);
    });
}

export { cleanupTestData };