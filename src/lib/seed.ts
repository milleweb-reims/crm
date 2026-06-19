import mongoose from "mongoose";
import { hash } from "bcryptjs";
import { User } from "./models/user.model";

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/crm-milleweb";

async function seed() {
  await mongoose.connect(MONGODB_URI);
  console.log("Connected to MongoDB");

  const existingAdmin = await User.findOne({ role: "admin" });
  if (existingAdmin) {
    console.log("Admin already exists:", existingAdmin.email);
    await mongoose.disconnect();
    return;
  }

  const passwordHash = await hash("Admin123!", 12);

  const admin = await User.create({
    name: "Admin Milleweb",
    email: "admin@milleweb.fr",
    passwordHash,
    role: "admin",
    isActive: true,
  });

  console.log("Admin created:", admin.email);
  console.log("Password: Admin123!");
  console.log("⚠️  Change this password after first login!");

  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
