import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import session from "express-session";
import flash from "connect-flash";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import connectDb from "./config/db.js";
import { attachUser } from "./middleware/auth.js";
import { authRouter } from "./routes/auth.js";
import { adminRouter } from "./routes/admin.js";
import { workflowRouter } from "./routes/workflow.js";
import { ownerRouter } from "./routes/owner.js";
import { initSocket } from "./socket/index.js";

dotenv.config();

process.on("unhandledRejection", (reason, promise) => {
  console.error("=== UNHANDLED PROMISE REJECTION ===");
  console.error("Reason:", reason);
  if (reason instanceof Error) {
    console.error("Stack trace:", reason.stack);
  } else {
    console.error("(Reason is not an Error object; no stack trace available)");
  }
  console.error("Promise:", promise);
});

process.on("uncaughtException", (err) => {
  console.error("=== UNCAUGHT EXCEPTION ===");
  console.error("Error:", err.message);
  console.error("Stack trace:", err.stack);
  process.exit(1);
});

const app = express();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

const disableRateLimit = process.env.DISABLE_RATE_LIMIT === "true";

app.use(helmet({ contentSecurityPolicy: false }));

if (!disableRateLimit) {
  app.use(limiter);
}

const port = Number(process.env.PORT || 3000);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.static(path.join(__dirname, "public")));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
  secret: process.env.SESSION_SECRET || "dev-secret",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true },
}));

app.use(flash());

app.use(attachUser);

app.use(async (req, res, next) => {
  res.locals.currentUser = req.user
    ? {
        id: req.user._id,
        role: req.user.role,
        name: req.user.name,
      }
    : null;

  res.locals.flash = {
    success: req.flash("success"),
    error: req.flash("error"),
  };



  next();
});

app.get("/", (req, res) => {
  if (req.user) {
    const role = req.user.role;
    if (role === "admin" || role === "owner") return res.redirect("/admin/workspace");
    if (role === "editor") return res.redirect("/editor/projects");
    return res.redirect("/");
  }
  res.render("home", { pageTitle: null });
});

app.use(authRouter);
app.use(workflowRouter);
app.use("/admin", adminRouter);
app.use("/admin", ownerRouter);

app.use((err, req, res, _next) => {
  console.error("=== GLOBAL EXPRESS ERROR HANDLER ===");
  console.error("Request:", req.method, req.originalUrl);
  console.error("Error:", err.message || err);
  if (err instanceof Error) {
    console.error("Stack trace:", err.stack);
  } else {
    console.error("(Error is not an Error instance)");
  }

  if (req.path.startsWith("/api/")) {
    return res.status(500).json({ error: "Internal server error." });
  }

  req.flash("error", "Something went wrong. Please try again.");
  const fallback =
    req.headers.referer ||
    (req.user?.role === "admin" ? "/admin/dashboard" : "/");
  res.status(500).redirect(fallback);
});

try {
  await connectDb();
} catch (e) {
  console.error("Server not started because MongoDB could not connect.");
  console.error("Fix your MONGODB_URI in .env (preferred) or MONGO_URI, then restart.");
  process.exit(1);
}

const server = app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});

initSocket(server);
