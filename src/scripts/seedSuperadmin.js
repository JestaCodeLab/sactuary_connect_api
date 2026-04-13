/**
 * One-time script to create the first superadmin account.
 *
 * Usage:
 *   SUPERADMIN_EMAIL=admin@sanctuaryconnect.org \
 *   SUPERADMIN_PASSWORD=ChangeMe123! \
 *   SUPERADMIN_FIRST=Platform \
 *   SUPERADMIN_LAST=Admin \
 *   node src/scripts/seedSuperadmin.js
 *
 * Or with defaults (for local dev only — change before production):
 *   node src/scripts/seedSuperadmin.js
 */

import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/sanctuary_connect';
const EMAIL = process.env.SUPERADMIN_EMAIL || 'superadmin@sanctuaryconnect.org';
const PASSWORD = process.env.SUPERADMIN_PASSWORD || 'ChangeMe123!';
const FIRST = process.env.SUPERADMIN_FIRST || 'Platform';
const LAST = process.env.SUPERADMIN_LAST || 'Admin';

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  role: { type: String, enum: ['superadmin', 'admin', 'pastor', 'staff', 'member'], default: 'member' },
  status: { type: String, enum: ['active', 'inactive', 'suspended'], default: 'active' },
  verified: { type: Boolean, default: false },
}, { timestamps: true });

const User = mongoose.models.User || mongoose.model('User', userSchema);

async function seed() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB');

  const existing = await User.findOne({ email: EMAIL });
  if (existing) {
    if (existing.role === 'superadmin') {
      console.log(`Superadmin already exists: ${EMAIL}`);
    } else {
      console.log(`A user with ${EMAIL} exists but is not a superadmin (role: ${existing.role}).`);
      console.log('Update their role manually if intended.');
    }
    await mongoose.disconnect();
    process.exit(0);
  }

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  await User.create({
    email: EMAIL,
    passwordHash,
    firstName: FIRST,
    lastName: LAST,
    role: 'superadmin',
    verified: true,
    status: 'active',
  });

  console.log(`\nSuperadmin created successfully:`);
  console.log(`  Email   : ${EMAIL}`);
  console.log(`  Password: ${PASSWORD}`);
  console.log(`\nLogin at /login and you will be routed to /superadmin/dashboard.`);
  console.log(`IMPORTANT: Change the password after first login.\n`);

  await mongoose.disconnect();
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
