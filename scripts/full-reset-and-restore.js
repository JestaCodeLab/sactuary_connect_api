#!/usr/bin/env node
/**
 * Full database wipe, then restore "Dwelling Place" from a JSON export
 * produced by export-dwelling-place.js.
 *
 * Wipes EVERY collection in the database (all organizations' data, not
 * just Dwelling Place's), then re-inserts the exported Organization,
 * Branches, Users, and Members with their original _ids preserved.
 *
 * The Organization's subscriptionId and financeAccountId are cleared on
 * restore since Subscription/FinanceAccount are wiped and not part of
 * the export bundle — the org will need to redo subscription/finance
 * setup. Member.departments is cleared for the same reason (Department
 * is wiped).
 *
 * Requires an interactive "yes" confirmation before the wipe happens.
 *
 * Usage:
 *   node scripts/full-reset-and-restore.js <path-to-export.json>
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import fs from 'fs';
import readline from 'readline';

import Organization from '../src/models/Organization.js';
import Branch from '../src/models/Branch.js';
import User from '../src/models/User.js';
import Member from '../src/models/Member.js';

import Attendance from '../src/models/Attendance.js';
import AttendanceRecord from '../src/models/AttendanceRecord.js';
import AuditLog from '../src/models/AuditLog.js';
import Department from '../src/models/Department.js';
import Donation from '../src/models/Donation.js';
import Event from '../src/models/Event.js';
import Expense from '../src/models/Expense.js';
import ExpenseCategory from '../src/models/ExpenseCategory.js';
import FinanceAccount from '../src/models/FinanceAccount.js';
import FundBucket from '../src/models/FundBucket.js';
import Invitation from '../src/models/Invitation.js';
import Message from '../src/models/Message.js';
import Notification from '../src/models/Notification.js';
import OfferingType from '../src/models/OfferingType.js';
import PasswordReset from '../src/models/PasswordReset.js';
import PlatformConfig from '../src/models/PlatformConfig.js';
import PrayerRequest from '../src/models/PrayerRequest.js';
import ProjectGroup from '../src/models/ProjectGroup.js';
import ServiceCode from '../src/models/ServiceCode.js';
import ShepherdAlert from '../src/models/ShepherdAlert.js';
import ShepherdAlertLog from '../src/models/ShepherdAlertLog.js';
import SmsCredit from '../src/models/SmsCredit.js';
import SmsLog from '../src/models/SmsLog.js';
import SmsPackage from '../src/models/SmsPackage.js';
import SmsPayment from '../src/models/SmsPayment.js';
import SmsTemplate from '../src/models/SmsTemplate.js';
import Subscription from '../src/models/Subscription.js';
import Transaction from '../src/models/Transaction.js';
import UserBranch from '../src/models/UserBranch.js';
import VerificationCode from '../src/models/VerificationCode.js';

dotenv.config();

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/sanctuary_connect';

// Every collection in the app gets wiped. Organization/Branch/User/Member
// are wiped here too, then selectively restored from the export file below.
const ALL_MODELS = [
  { name: 'Attendance', model: Attendance },
  { name: 'AttendanceRecord', model: AttendanceRecord },
  { name: 'AuditLog', model: AuditLog },
  { name: 'Branch', model: Branch },
  { name: 'Department', model: Department },
  { name: 'Donation', model: Donation },
  { name: 'Event', model: Event },
  { name: 'Expense', model: Expense },
  { name: 'ExpenseCategory', model: ExpenseCategory },
  { name: 'FinanceAccount', model: FinanceAccount },
  { name: 'FundBucket', model: FundBucket },
  { name: 'Invitation', model: Invitation },
  { name: 'Member', model: Member },
  { name: 'Message', model: Message },
  { name: 'Notification', model: Notification },
  { name: 'OfferingType', model: OfferingType },
  { name: 'Organization', model: Organization },
  { name: 'PasswordReset', model: PasswordReset },
  { name: 'PlatformConfig', model: PlatformConfig },
  { name: 'PrayerRequest', model: PrayerRequest },
  { name: 'ProjectGroup', model: ProjectGroup },
  { name: 'ServiceCode', model: ServiceCode },
  { name: 'ShepherdAlert', model: ShepherdAlert },
  { name: 'ShepherdAlertLog', model: ShepherdAlertLog },
  { name: 'SmsCredit', model: SmsCredit },
  { name: 'SmsLog', model: SmsLog },
  { name: 'SmsPackage', model: SmsPackage },
  { name: 'SmsPayment', model: SmsPayment },
  { name: 'SmsTemplate', model: SmsTemplate },
  { name: 'Subscription', model: Subscription },
  { name: 'Transaction', model: Transaction },
  { name: 'User', model: User },
  { name: 'UserBranch', model: UserBranch },
  { name: 'VerificationCode', model: VerificationCode },
];

function confirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

async function run() {
  const exportPath = process.argv[2];
  if (!exportPath) {
    console.error('Usage: node scripts/full-reset-and-restore.js <path-to-export.json>');
    process.exit(1);
  }

  const backup = JSON.parse(fs.readFileSync(exportPath, 'utf-8'));
  const { organization, branches, users, members } = backup;

  if (!organization) {
    console.error('Export file has no organization data. Aborting.');
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI);
  console.log(`Connected to ${MONGO_URI}\n`);

  console.log(`Will restore: "${organization.churchName}" (${organization._id})`);
  console.log(`  Branches: ${branches.length}`);
  console.log(`  Users:    ${users.length}`);
  console.log(`  Members:  ${members.length}`);

  console.log('\nAbout to WIPE every collection in the database (ALL organizations, not just this one):');
  for (const { name, model } of ALL_MODELS) {
    console.log(`  - ${name} (${await model.countDocuments()} docs)`);
  }

  const answer = await confirm('\nType "yes" to proceed with the full wipe + restore: ');
  if (answer !== 'yes') {
    console.log('Aborted. No data was changed.');
    await mongoose.disconnect();
    process.exit(0);
  }

  console.log('\nWiping...');
  for (const { name, model } of ALL_MODELS) {
    await model.deleteMany({});
    console.log(`  - ${name} cleared`);
  }

  console.log('\nRestoring Dwelling Place...');

  // Use Mongoose model methods (not .collection.insertMany) so ObjectId/Date
  // fields get cast back from the JSON export's plain strings to real BSON
  // types — a raw driver insert would leave _id/refs/dates as strings.
  const restoredOrg = { ...organization };
  delete restoredOrg.subscriptionId;
  delete restoredOrg.financeAccountId;
  await Organization.create(restoredOrg);
  console.log(`  - Organization restored (subscriptionId/financeAccountId cleared)`);

  if (branches.length > 0) {
    await Branch.insertMany(branches, { ordered: true });
    console.log(`  - ${branches.length} branch(es) restored`);
  }

  if (users.length > 0) {
    await User.insertMany(users, { ordered: true });
    console.log(`  - ${users.length} user(s) restored`);
  }

  if (members.length > 0) {
    const restoredMembers = members.map((m) => ({ ...m, departments: [] }));
    await Member.insertMany(restoredMembers, { ordered: true });
    console.log(`  - ${members.length} member(s) restored (departments cleared)`);
  }

  console.log('\nDone. Full reset + Dwelling Place restore complete.');
  await mongoose.disconnect();
  process.exit(0);
}

run().catch(async (error) => {
  console.error('Script failed:', error);
  await mongoose.disconnect();
  process.exit(1);
});
