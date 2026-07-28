import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { seedTestData } from "./seed.mjs";

const mongod = await MongoMemoryServer.create();
const uri = mongod.getUri();

process.env.MONGODB_URI = uri;
process.env.PORT = "7890";
process.env.SESSION_SECRET = "test-secret-not-secure";

await mongoose.connect(uri);
console.log("Seeding test data...");
await seedTestData();
await mongoose.disconnect();
console.log("Seed complete. MONGODB_URI=" + uri);

console.log("PORT=7890");

process.on("SIGTERM", async () => {
  await mongod.stop();
  process.exit(0);
});
