#!/usr/bin/env node
/**
 * Database Reset Script
 * Removes all users and related data from the database
 *
 * Usage: node scripts/reset-database.js [--all]
 *   --all: Also removes organizations, branches, and fund buckets
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { createInterface } from 'readline';

// Load environment variables
dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/sanctuary_connect';

// Import models
import User from '../src/models/User.js';
import VerificationCode from '../src/models/VerificationCode.js';
import PasswordReset from '../src/models/PasswordReset.js';
import Organization from '../src/models/Organization.js';
import Branch from '../src/models/Branch.js';
import FundBucket from '../src/models/FundBucket.js';
import Subscription from '../src/models/Subscription.js';

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

const prompt = (question) => {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
};

async function connectDB() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');
  } catch (error) {
    console.error('MongoDB connection error:', error.message);
    process.exit(1);
  }
}

async function clearUsers() {
  console.log('\n--- Clearing User Data ---');

  const userCount = await User.countDocuments();
  const verificationCount = await VerificationCode.countDocuments();
  const passwordResetCount = await PasswordReset.countDocuments();

  console.log(`Found: ${userCount} users, ${verificationCount} verification codes, ${passwordResetCount} password resets`);

  const result1 = await User.deleteMany({});
  const result2 = await VerificationCode.deleteMany({});
  const result3 = await PasswordReset.deleteMany({});

  console.log(`Deleted: ${result1.deletedCount} users`);
  console.log(`Deleted: ${result2.deletedCount} verification codes`);
  console.log(`Deleted: ${result3.deletedCount} password resets`);
}

async function clearOrganizations() {
  console.log('\n--- Clearing Organization Data ---');

  const orgCount = await Organization.countDocuments();
  const branchCount = await Branch.countDocuments();
  const fundCount = await FundBucket.countDocuments();
  const subCount = await Subscription.countDocuments();

  console.log(`Found: ${orgCount} organizations, ${branchCount} branches, ${fundCount} fund buckets, ${subCount} subscriptions`);

  const result1 = await Organization.deleteMany({});
  const result2 = await Branch.deleteMany({});
  const result3 = await FundBucket.deleteMany({});
  const result4 = await Subscription.deleteMany({});

  console.log(`Deleted: ${result1.deletedCount} organizations`);
  console.log(`Deleted: ${result2.deletedCount} branches`);
  console.log(`Deleted: ${result3.deletedCount} fund buckets`);
  console.log(`Deleted: ${result4.deletedCount} subscriptions`);
}

async function main() {
  const args = process.argv.slice(2);
  const clearAll = args.includes('--all');

  console.log('\n========================================');
  console.log('  SANCTUARY CONNECT - DATABASE RESET');
  console.log('========================================\n');
  console.log(`Database: ${MONGODB_URI}`);
  console.log(`Mode: ${clearAll ? 'Full reset (users + organizations)' : 'Users only'}`);
  console.log('\nThis will permanently delete:');
  console.log('  - All users');
  console.log('  - All verification codes');
  console.log('  - All password reset tokens');
  if (clearAll) {
    console.log('  - All organizations');
    console.log('  - All branches');
    console.log('  - All fund buckets');
    console.log('  - All subscriptions');
  }

  const answer = await prompt('\nAre you sure you want to continue? (yes/no): ');

  if (answer.toLowerCase() !== 'yes') {
    console.log('\nOperation cancelled.');
    rl.close();
    process.exit(0);
  }

  await connectDB();

  await clearUsers();

  if (clearAll) {
    await clearOrganizations();
  }

  console.log('\n========================================');
  console.log('  DATABASE RESET COMPLETE');
  console.log('========================================\n');

  rl.close();
  await mongoose.connection.close();
  process.exit(0);
}

main().catch((error) => {
  console.error('Error:', error.message);
  rl.close();
  process.exit(1);
});
