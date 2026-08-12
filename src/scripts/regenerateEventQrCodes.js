/**
 * Repairs events whose stored QR code image (qrCode.dataUrl) was baked with
 * a wrong CLIENT_URL (e.g. localhost) at generation time. Re-renders the QR
 * image for the *same* token — so already-shared check-in links keep
 * working — using this process's current CLIENT_URL.
 *
 * Defaults to a dry run (reports what would change, writes nothing).
 * Pass --apply to actually update the database.
 *
 * CLIENT_URL and MONGODB_URI must be set correctly for the target
 * environment when you run this — it does not assume any particular
 * deployment's values. Example:
 *
 *   CLIENT_URL=https://app.sanctuaryconnect.org MONGODB_URI="<prod-uri>" \
 *     node api/src/scripts/regenerateEventQrCodes.js --apply
 *
 * Run once per environment (production, UAT, ...) against that
 * environment's own database.
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import QRCode from 'qrcode';
import path from 'path';
import { fileURLToPath } from 'url';
import { assertClientUrlMatchesDatabase } from '../utils/urlSafety.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Only fills in values not already present in the environment — lets you
// override CLIENT_URL/MONGODB_URI inline on the command line as shown above.
dotenv.config({ path: path.join(__dirname, '../../.env') });

const MONGODB_URI = process.env.MONGODB_URI;
const CLIENT_URL = process.env.CLIENT_URL;
const APPLY = process.argv.includes('--apply');

if (!MONGODB_URI) {
  console.error('MONGODB_URI not set');
  process.exit(1);
}
if (!CLIENT_URL) {
  console.error('CLIENT_URL not set');
  process.exit(1);
}

try {
  assertClientUrlMatchesDatabase(CLIENT_URL, MONGODB_URI);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

async function run() {
  await mongoose.connect(MONGODB_URI);
  console.log(`Connected to MongoDB`);
  console.log(`CLIENT_URL: ${CLIENT_URL}`);
  console.log(APPLY ? 'Mode: APPLY (writing changes)' : 'Mode: DRY RUN (pass --apply to write changes)');

  const Event = mongoose.connection.collection('events');
  const events = await Event.find({ 'qrCode.token': { $exists: true, $ne: null } }).toArray();
  console.log(`Found ${events.length} event(s) with a QR code`);

  let updated = 0;

  // The URL isn't stored separately from the rendered PNG, so there's no way
  // to tell which events are actually wrong without decoding every image.
  // Re-rendering all of them against the correct CLIENT_URL is cheap and
  // idempotent, so we just do that unconditionally rather than guessing.
  for (const event of events) {
    const token = event.qrCode.token;
    const correctCheckInUrl = `${CLIENT_URL}/check-in/${token}`;

    if (APPLY) {
      const dataUrl = await QRCode.toDataURL(correctCheckInUrl, {
        errorCorrectionLevel: 'M',
        width: 400,
        margin: 2,
      });

      await Event.updateOne(
        { _id: event._id },
        {
          $set: {
            'qrCode.dataUrl': dataUrl,
            'qrCode.generatedAt': new Date(),
            updatedAt: new Date(),
          },
        }
      );
      updated += 1;
      console.log(`Regenerated QR for "${event.title}" (${event._id}) -> ${correctCheckInUrl}`);
    } else {
      console.log(`Would regenerate QR for "${event.title}" (${event._id}) -> ${correctCheckInUrl}`);
    }
  }

  console.log(APPLY ? `Updated ${updated} event(s).` : `${events.length} event(s) would be updated. Re-run with --apply to write changes.`);
}

run()
  .catch((err) => {
    console.error('Script failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  });
