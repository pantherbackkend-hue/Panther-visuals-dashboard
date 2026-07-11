import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import connectDb from "./config/db.js";
import { User } from "./models/User.js";
import { Shop } from "./models/Shop.js";
import { MenuItem } from "./models/MenuItem.js";

dotenv.config();

const EDITOR_EMAIL = "editor@panthervisuals.com";
const CLIENT_EMAIL = "client@panthervisuals.test";
const ADMIN_EMAIL = "admin@panthervisuals.com";
const SHOP_SLUG = "design-studio";
const DEFAULT_PASSWORD = "password123";
const ADMIN_PASSWORD = "admin@1";

async function seed() {
  await connectDb();

  await User.deleteMany({ email: { $in: [EDITOR_EMAIL, CLIENT_EMAIL, ADMIN_EMAIL] } });

  const oldShop = await Shop.findOne({ slug: SHOP_SLUG });
  if (oldShop) {
    await MenuItem.deleteMany({ shop: oldShop._id });
    await Shop.deleteOne({ _id: oldShop._id });
    await User.updateMany({ shop: oldShop._id }, { $set: { shop: null } });
  }

  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
  const adminPasswordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);

  const editor = await User.create({
    name: "Design Editor",
    email: EDITOR_EMAIL,
    passwordHash,
    role: "editor",
  });

  const shop = await Shop.create({
    name: "Design Studio",
    slug: SHOP_SLUG,
    description: "Graphic design, branding, and visual assets.",
    vendor: editor._id,
  });

  await User.updateOne({ _id: editor._id }, { $set: { shop: shop._id } });

  await User.create({
    name: "Test Client",
    email: CLIENT_EMAIL,
    passwordHash,
    role: "client",
  });

  await User.create({
    name: "Super Admin",
    email: ADMIN_EMAIL,
    passwordHash: adminPasswordHash,
    role: "admin",
  });

  await MenuItem.insertMany([
    { shop: shop._id, name: "Logo Design", description: "Custom logo with 3 revisions.", price: 5000, available: true },
    { shop: shop._id, name: "Business Card", description: "Double-sided print-ready design.", price: 2000, available: true },
    { shop: shop._id, name: "Social Media Kit", description: "5 post templates.", price: 3000, available: true },
    { shop: shop._id, name: "Brand Guide", description: "Full brand identity document.", price: 10000, available: true },
  ]);

  console.log("Seed complete.");
  console.log(`  Editor: ${EDITOR_EMAIL} / ${DEFAULT_PASSWORD}`);
  console.log(`  Client: ${CLIENT_EMAIL} / ${DEFAULT_PASSWORD}`);
  console.log(`  Admin: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  console.log(`  Workspace URL: http://localhost:${process.env.PORT || 3000}/workspaces/${SHOP_SLUG}`);
  process.exit(0);
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
