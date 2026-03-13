/**
 * One-time cleanup script to delete all existing recurring events
 * and their associated attendance data.
 *
 * Run: node api/src/scripts/cleanupRecurringEvents.js
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../.env') });

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('MONGODB_URI not set in .env');
  process.exit(1);
}

async function cleanup() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    const Event = mongoose.connection.collection('events');
    const AttendanceRecord = mongoose.connection.collection('attendancerecords');

    // 1. Find all child events (those with parentEventId set)
    const childEvents = await Event.find({ parentEventId: { $exists: true, $ne: null } }).toArray();
    const childIds = childEvents.map(e => e._id);
    console.log(`Found ${childIds.length} child event instances`);

    // 2. Delete attendance records for child events
    if (childIds.length > 0) {
      const delAttChild = await AttendanceRecord.deleteMany({ eventId: { $in: childIds } });
      console.log(`Deleted ${delAttChild.deletedCount} attendance records for child events`);
    }

    // 3. Delete child event documents
    if (childIds.length > 0) {
      const delChild = await Event.deleteMany({ _id: { $in: childIds } });
      console.log(`Deleted ${delChild.deletedCount} child event documents`);
    }

    // 4. Find all parent recurring events
    const recurringEvents = await Event.find({ isRecurring: true }).toArray();
    const recurringIds = recurringEvents.map(e => e._id);
    console.log(`Found ${recurringIds.length} parent recurring events`);

    // 5. Delete attendance records for parent recurring events
    if (recurringIds.length > 0) {
      const delAttParent = await AttendanceRecord.deleteMany({ eventId: { $in: recurringIds } });
      console.log(`Deleted ${delAttParent.deletedCount} attendance records for parent recurring events`);
    }

    // 6. Delete parent recurring events
    if (recurringIds.length > 0) {
      const delParent = await Event.deleteMany({ _id: { $in: recurringIds } });
      console.log(`Deleted ${delParent.deletedCount} parent recurring event documents`);
    }

    // 7. Clean up any remaining parentEventId references
    const cleanupResult = await Event.updateMany(
      { parentEventId: { $exists: true } },
      { $unset: { parentEventId: '' } }
    );
    if (cleanupResult.modifiedCount > 0) {
      console.log(`Cleaned up parentEventId from ${cleanupResult.modifiedCount} remaining events`);
    }

    console.log('Cleanup complete!');
  } catch (error) {
    console.error('Cleanup failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

cleanup();
