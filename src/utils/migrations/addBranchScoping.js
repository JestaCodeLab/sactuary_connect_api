/**
 * Migration: Add Branch Scoping
 *
 * Backfills organizationId and branchId on all data models.
 * For each organization:
 *   1. Find or create a default branch (head office or first branch)
 *   2. Set user.organizationId for the admin
 *   3. Create UserBranch records for admin → all branches
 *   4. Backfill organizationId + branchId on all resource models
 *
 * Usage:
 *   node --experimental-modules src/utils/migrations/addBranchScoping.js [--dry-run]
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import connectDB from '../../config/database.js';
import Organization from '../../models/Organization.js';
import Branch from '../../models/Branch.js';
import User from '../../models/User.js';
import UserBranch from '../../models/UserBranch.js';
import Member from '../../models/Member.js';
import Event from '../../models/Event.js';
import Donation from '../../models/Donation.js';
import Expense from '../../models/Expense.js';
import Attendance from '../../models/Attendance.js';
import Message from '../../models/Message.js';
import PrayerRequest from '../../models/PrayerRequest.js';
import Department from '../../models/Department.js';

dotenv.config();

const isDryRun = process.argv.includes('--dry-run');

function log(msg) {
  console.log(`${isDryRun ? '[DRY RUN] ' : ''}${msg}`);
}

async function migrate() {
  await connectDB();
  log('Connected to database');

  const organizations = await Organization.find({});
  log(`Found ${organizations.length} organization(s)`);

  for (const org of organizations) {
    log(`\n--- Processing: ${org.churchName} (${org._id}) ---`);

    // 1. Find default branch
    let branches = await Branch.find({ organizationId: org._id });
    let defaultBranch;

    if (branches.length === 0) {
      log('No branches found — creating "Main Campus"');
      if (!isDryRun) {
        defaultBranch = await Branch.create({
          organizationId: org._id,
          name: 'Main Campus',
          isHeadOffice: true,
        });
        branches = [defaultBranch];
      } else {
        defaultBranch = { _id: 'DRY_RUN_ID', name: 'Main Campus' };
      }
    } else {
      defaultBranch = branches.find(b => b.isHeadOffice) || branches[0];
    }

    log(`Default branch: ${defaultBranch.name} (${defaultBranch._id})`);

    // 2. Set admin user organizationId
    if (org.adminId) {
      const admin = await User.findById(org.adminId);
      if (admin && !admin.organizationId) {
        log(`Setting organizationId on admin user: ${admin.email}`);
        if (!isDryRun) {
          admin.organizationId = org._id;
          await admin.save();
        }
      }

      // 3. Create UserBranch records for admin → all branches
      for (const branch of branches) {
        const existing = await UserBranch.findOne({
          userId: org.adminId,
          branchId: branch._id,
        });
        if (!existing) {
          log(`Assigning admin to branch: ${branch.name}`);
          if (!isDryRun) {
            await UserBranch.create({
              userId: org.adminId,
              branchId: branch._id,
              organizationId: org._id,
            });
          }
        }
      }
    }

    const defaultBranchId = defaultBranch._id;

    // 4. Backfill all resource models
    const modelsToBackfill = [
      { name: 'Member', model: Member, hasOrgId: false },
      { name: 'Event', model: Event, hasOrgId: true },
      { name: 'Donation', model: Donation, hasOrgId: false },
      { name: 'Expense', model: Expense, hasOrgId: true },
      { name: 'Attendance', model: Attendance, hasOrgId: false },
      { name: 'Message', model: Message, hasOrgId: false },
      { name: 'PrayerRequest', model: PrayerRequest, hasOrgId: false },
      { name: 'Department', model: Department, hasOrgId: true },
    ];

    for (const { name, model, hasOrgId } of modelsToBackfill) {
      let countMissingOrg = 0;

      // Documents missing organizationId
      if (!hasOrgId) {
        const missingOrgFilter = {
          $or: [
            { organizationId: { $exists: false } },
            { organizationId: null },
          ],
        };
        countMissingOrg = await model.countDocuments(missingOrgFilter);
        if (countMissingOrg > 0) {
          log(`${name}: setting organizationId on ${countMissingOrg} document(s)`);
          if (!isDryRun) {
            await model.updateMany(missingOrgFilter, {
              $set: { organizationId: org._id },
            });
          }
        }
      }

      // Documents missing branchId (for all models)
      const missingBranchFilter = {
        organizationId: org._id,
        $or: [
          { branchId: { $exists: false } },
          { branchId: null },
        ],
      };

      const countMissingBranch = await model.countDocuments(missingBranchFilter);
      if (countMissingBranch > 0) {
        log(`${name}: setting branchId on ${countMissingBranch} document(s) → ${defaultBranch.name}`);
        if (!isDryRun) {
          await model.updateMany(missingBranchFilter, {
            $set: { branchId: defaultBranchId },
          });
        }
      }

      if (countMissingOrg === 0 && countMissingBranch === 0) {
        log(`${name}: already up to date`);
      }
    }
  }

  log('\nMigration complete!');

  if (!isDryRun) {
    await mongoose.disconnect();
  } else {
    log('(No changes were made — this was a dry run)');
    await mongoose.disconnect();
  }

  process.exit(0);
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
