#!/usr/bin/env node
/**
 * Export "Dwelling Place" organization + its Branches, Users, and Members
 * to a JSON backup file, ahead of a full database wipe/reimport.
 *
 * Read-only — does not modify any data.
 *
 * Usage:
 *   node scripts/export-dwelling-place.js
 *   CHURCH_NAME="Dwelling Place" node scripts/export-dwelling-place.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import Organization from '../src/models/Organization.js';
import Branch from '../src/models/Branch.js';
import User from '../src/models/User.js';
import Member from '../src/models/Member.js';

dotenv.config();

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/sanctuary_connect';
const CHURCH_NAME = process.env.CHURCH_NAME || 'Dwelling Place';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKUP_DIR = path.join(__dirname, '..', 'backups');

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log(`Connected to ${MONGO_URI}\n`);

  const org = await Organization.findOne({
    churchName: new RegExp(CHURCH_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
  }).lean();

  if (!org) {
    console.error(`No organization found with churchName matching "${CHURCH_NAME}". Aborting.`);
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log(`Found organization: "${org.churchName}" (${org._id})`);

  const branches = await Branch.find({ organizationId: org._id }).lean();
  const users = await User.find({ organizationId: org._id }).lean();
  const members = await Member.find({ organizationId: org._id }).lean();

  console.log(`  Branches: ${branches.length}`);
  console.log(`  Users:    ${users.length}`);
  console.log(`  Members:  ${members.length}`);

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(BACKUP_DIR, `dwelling-place-export-${timestamp}.json`);

  fs.writeFileSync(
    backupPath,
    JSON.stringify({ exportedAt: new Date().toISOString(), organization: org, branches, users, members }, null, 2)
  );

  console.log(`\nBackup written to: ${backupPath}`);
  await mongoose.disconnect();
  process.exit(0);
}

run().catch(async (error) => {
  console.error('Export failed:', error);
  await mongoose.disconnect();
  process.exit(1);
});
