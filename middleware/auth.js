import { User } from "../models/User.js";

export async function attachUser(req, res, next) {
  req.user = undefined;
  if (!req.session?.userId) {
    return next();
  }

  try {
    const user = await User.findById(req.session.userId).select("-passwordHash").lean();
    if (!user || user.isActive === false) {
      delete req.session.userId;
      return next();
    }
    req.user = user;
    return next();
  } catch (err) {
    return next(err);
  }
}

export async function requireAuth(req, res, next) {
  if (!req.session?.userId) {
    req.flash("error", "Please log in to continue.");
    return res.redirect("/login");
  }

  const sid = String(req.session.userId);
  if (req.user && String(req.user._id) === sid) {
    return next();
  }

  try {
    const user = await User.findById(req.session.userId).select("-passwordHash").lean();
    if (!user || user.isActive === false) {
      req.flash("error", "Please log in to continue.");
      delete req.session.userId;
      return res.redirect("/login");
    }
    req.user = user;
    return next();
  } catch (err) {
    return next(err);
  }
}

export function requireEditor(req, res, next) {
  if (!req.user || req.user.role !== "editor") {
    req.flash("error", "Editor access only.");
    return res.redirect("/");
  }
  return next();
}

export function requireAdmin(req, res, next) {
  if (!req.user || (req.user.role !== "admin" && req.user.role !== "owner")) {
    req.flash("error", "Admin access only.");
    return res.redirect("/");
  }
  return next();
}

