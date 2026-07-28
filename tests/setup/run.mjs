import { MongoMemoryServer } from "mongodb-memory-server";

const mongod = await MongoMemoryServer.create();
const uri = mongod.getUri();

process.env.MONGODB_URI = uri;
process.env.PORT = "7890";
process.env.SESSION_SECRET = "test-secret-not-secure";

global.__MONGOD__ = mongod;

await import("./seed.mjs");

console.log(`Test server will start on port ${process.env.PORT}`);

const { default: connectDb } = await import("../../config/db.js");
import mongoose from "mongoose";
await connectDb();

// Now that DB is connected, seed
const { seedTestData } = await import("./seed.mjs");
await seedTestData();
console.log("Seed complete. " + new Date().toISOString());

await mongoose.disconnect();

// Start the actual app server
await import("../../server.js");
