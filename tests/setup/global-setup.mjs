import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { seedTestData } from "./seed.mjs";

let mongod;

export default async function globalSetup() {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  process.env.MONGODB_URI = uri;
  process.env.PORT = "7890";
  process.env.SESSION_SECRET = "test-secret-not-secure";

  global.__MONGOD__ = mongod;

  await mongoose.connect(uri);
  await seedTestData();
  await mongoose.disconnect();
}
