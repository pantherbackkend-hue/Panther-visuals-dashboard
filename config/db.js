import mongoose from "mongoose";

export default async function connectDb() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || "mongodb://127.0.0.1:27017/panther_visuals";
  mongoose.set("bufferCommands", false);
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 8000,
    socketTimeoutMS: 20000,
  });
  console.log("MongoDB connected to", uri.replace(/\/\/[^:]+:[^@]+@/, "//<credentials>@"));
}
