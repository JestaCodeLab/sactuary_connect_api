/**
 * Reset the database for a fresh testing environment, while preserving
 * Dwelling Place Church's member roster across the wipe.
 *
 * What survives untouched: Organization, Branch, User, UserBranch,
 * Subscription, FinanceAccount, SmsPackage, PlatformConfig.
 *
 * What gets wiped: every other collection (Attendance, AttendanceRecord,
 * Department, Donation, Event, Expense, ExpenseCategory, FundBucket,
 * Invitation, Member, Message, Notification, OfferingType, PasswordReset,
 * PrayerRequest, ProjectGroup, ServiceCode, ShepherdAlert, ShepherdAlertLog,
 * SmsCredit, SmsLog, SmsPayment, SmsTemplate, Transaction, VerificationCode,
 * AuditLog).
 *
 * Dwelling Place Church's Member documents are exported to a JSON backup
 * before the wipe, then re-inserted afterward with their original _id
 * (so familyMembers self-references stay valid) but with `departments`
 * cleared (Department is wiped, so those refs would otherwise dangle).
 *
 * Usage:
 *   node src/scripts/resetDbPreservingMembers.js
 *   CHURCH_NAME="Dwelling Place Church" node src/scripts/resetDbPreservingMembers.js
 *
 * Requires an interactive "yes" confirmation before the wipe happens.
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

import Organization from '../models/Organization.js';
import Member from '../models/Member.js';

// Only collections NOT in this preserve list get wiped.
import Attendance from '../models/Attendance.js';
import AttendanceRecord from '../models/AttendanceRecord.js';
import AuditLog from '../models/AuditLog.js';
import Department from '../models/Department.js';
import Donation from '../models/Donation.js';
import Event from '../models/Event.js';
import Expense from '../models/Expense.js';
import ExpenseCategory from '../models/ExpenseCategory.js';
import FundBucket from '../models/FundBucket.js';
import Invitation from '../models/Invitation.js';
import Message from '../models/Message.js';
import Notification from '../models/Notification.js';
import OfferingType from '../models/OfferingType.js';
import PasswordReset from '../models/PasswordReset.js';
import PrayerRequest from '../models/PrayerRequest.js';
import ProjectGroup from '../models/ProjectGroup.js';
import ServiceCode from '../models/ServiceCode.js';
import ShepherdAlert from '../models/ShepherdAlert.js';
import ShepherdAlertLog from '../models/ShepherdAlertLog.js';
import SmsCredit from '../models/SmsCredit.js';
import SmsLog from '../models/SmsLog.js';
import SmsPayment from '../models/SmsPayment.js';
import SmsTemplate from '../models/SmsTemplate.js';
import Transaction from '../models/Transaction.js';
import VerificationCode from '../models/VerificationCode.js';

dotenv.config();

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/sanctuary_connect';
const CHURCH_NAME = process.env.CHURCH_NAME || 'Dwelling Place Church';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKUP_DIR = path.join(__dirname, '..', '..', 'backups');

// Wiped in full - Member is handled separately (wiped, then Dwelling Place's restored)
const COLLECTIONS_TO_WIPE = [
  { name: 'Attendance', model: Attendance },
  { name: 'AttendanceRecord', model: AttendanceRecord },
  { name: 'AuditLog', model: AuditLog },
  { name: 'Department', model: Department },
  { name: 'Donation', model: Donation },
  { name: 'Event', model: Event },
  { name: 'Expense', model: Expense },
  { name: 'ExpenseCategory', model: ExpenseCategory },
  { name: 'FundBucket', model: FundBucket },
  { name: 'Invitation', model: Invitation },
  { name: 'Message', model: Message },
  { name: 'Notification', model: Notification },
  { name: 'OfferingType', model: OfferingType },
  { name: 'PasswordReset', model: PasswordReset },
  { name: 'PrayerRequest', model: PrayerRequest },
  { name: 'ProjectGroup', model: ProjectGroup },
  { name: 'ServiceCode', model: ServiceCode },
  { name: 'ShepherdAlert', model: ShepherdAlert },
  { name: 'ShepherdAlertLog', model: ShepherdAlertLog },
  { name: 'SmsCredit', model: SmsCredit },
  { name: 'SmsLog', model: SmsLog },
  { name: 'SmsPayment', model: SmsPayment },
  { name: 'SmsTemplate', model: SmsTemplate },
  { name: 'Transaction', model: Transaction },
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
  await mongoose.connect(MONGO_URI);
  console.log(`Connected to ${MONGO_URI}\n`);

  // --- 1. Find the church ---
  const org = await Organization.findOne({
    churchName: new RegExp(`^${CHURCH_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
  });

  if (!org) {
    console.error(`No organization found with churchName matching "${CHURCH_NAME}". Aborting - nothing was touched.`);
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log(`Found organization: "${org.churchName}" (${org._id})`);

  // --- 2. Export its members ---
  const members = await Member.find({ organizationId: org._id }).lean();
  console.log(`Exporting ${members.length} member(s)...`);

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(BACKUP_DIR, `dwelling-place-members-${timestamp}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(members, null, 2));
  console.log(`Backup written to ${backupPath}\n`);

  // --- 3. Confirm before wiping ---
  console.log('About to WIPE (all organizations, not just this one):');
  console.log(`  - Member (${await Member.countDocuments()} total docs) - Dwelling Place Church's ${members.length} will be restored after`);
  for (const { name, model } of COLLECTIONS_TO_WIPE) {
    console.log(`  - ${name} (${await model.countDocuments()} docs)`);
  }
  console.log('\nPreserved untouched: Organization, Branch, User, UserBranch, Subscription, FinanceAccount, SmsPackage, PlatformConfig.\n');

  const answer = await confirm('Type "yes" to proceed with the wipe: ');
  if (answer !== 'yes') {
    console.log('Aborted. No data was changed. Your backup file is still saved at:', backupPath);
    await mongoose.disconnect();
    process.exit(0);
  }

  // --- 4. Wipe ---
  console.log('\nWiping...');
  await Member.deleteMany({});
  console.log('  - Member cleared');
  for (const { name, model } of COLLECTIONS_TO_WIPE) {
    await model.deleteMany({});
    console.log(`  - ${name} cleared`);
  }

  // --- 5. Re-import Dwelling Place Church's members ---
  console.log(`\nRestoring ${members.length} member(s) for "${org.churchName}"...`);
  if (members.length > 0) {
    const restored = members.map((m) => ({ ...m, departments: [] })); // Department was wiped
    await Member.insertMany(restored, { ordered: true });
  }

  console.log('\nDone. Database reset complete, member backup saved at:', backupPath);
  await mongoose.disconnect();
  process.exit(0);
}

run().catch(async (error) => {
  console.error('Script failed:', error);
  await mongoose.disconnect();
  process.exit(1);
});
