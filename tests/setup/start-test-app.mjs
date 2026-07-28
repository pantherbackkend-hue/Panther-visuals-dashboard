import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { seedTestData } from "./seed.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");

async function start() {
  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();

  process.env.MONGODB_URI = uri;
  process.env.PORT = "7890";
  process.env.SESSION_SECRET = "test-secret-not-secure";

  await mongoose.connect(uri);
  console.log("Seeding test data...");
  const data = await seedTestData();
  await mongoose.disconnect();
  console.log("Seed complete.");

  const serverProcess = spawn("node", ["server.js"], {
    cwd: projectRoot,
    env: { ...process.env },
    stdio: ["pipe", "pipe", "pipe"],
  });

  serverProcess.stdout.on("data", (d) => {
    const msg = d.toString();
    process.stdout.write(msg);
    if (msg.includes("Server running on")) {
      const match = msg.match(/http:\/\/localhost:(\d+)/);
      if (match) {
        const port = match[1];
        console.log(`\nTEST_SERVER_PORT=${port}`);
      }
    }
  });

  serverProcess.stderr.on("data", (d) => process.stderr.write(d.toString()));

  let resolved = false;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        console.log("Server started (timeout fallback)");
        resolve();
      }
    }, 15000);

    serverProcess.stdout.on("data", (d) => {
      if (!resolved && d.toString().includes("Server running on")) {
        resolved = true;
        clearTimeout(timeout);
        setTimeout(resolve, 500);
      }
    });

    serverProcess.on("error", (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(err);
      }
    });

    process.on("SIGINT", () => {
      serverProcess.kill("SIGINT");
      mongod.stop();
      process.exit(0);
    });

    process.on("SIGTERM", () => {
      serverProcess.kill("SIGTERM");
      mongod.stop();
      process.exit(0);
    });
  });

  global.__MONGOD__ = mongod;
  global.__SERVER_PROCESS__ = serverProcess;
}

start().catch((err) => {
  console.error("Failed to start test app:", err);
  process.exit(1);
});
