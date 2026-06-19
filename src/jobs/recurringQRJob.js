import { v4 as uuidv4 } from 'uuid';
import QRCode from 'qrcode';
import Event from '../models/Event.js';
import { getNextOccurrence, getCurrentOccurrence } from '../utils/occurrenceHelper.js';

const INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

async function refreshRecurringQRCodes() {
  try {
    const events = await Event.find({
      isRecurring: true,
      status: { $nin: ['cancelled', 'completed'] },
    });

    const now = new Date();

    for (const event of events) {
      try {
        // Skip if event already has a permanent QR (no expiration = permanent token for all occurrences)
        if (event.qrCode?.token && !event.qrCode?.expiresAt) {
          continue; // Permanent QR already set, don't override
        }

        // Find the current or next occurrence
        const occurrence = getCurrentOccurrence(event, now) || getNextOccurrence(event, now);
        if (!occurrence) continue; // Series has ended

        // Check if we already have a valid QR for this occurrence
        if (
          event.qrCode?.token &&
          event.qrCode?.expiresAt &&
          new Date(event.qrCode.expiresAt) > now &&
          event.qrCode.occurrenceDate &&
          new Date(event.qrCode.occurrenceDate).getTime() === occurrence.startDate.getTime()
        ) {
          continue; // QR is still valid for this occurrence
        }

        // Generate a fresh QR code for this occurrence
        const token = uuidv4();
        const expiresAt = new Date(occurrence.endDate);
        expiresAt.setHours(expiresAt.getHours() + 2);

        const checkInUrl = `${process.env.CLIENT_URL || 'https://app.sanctuaryconnect.org'}/check-in/${token}`;
        const dataUrl = await QRCode.toDataURL(checkInUrl, {
          errorCorrectionLevel: 'M',
          width: 400,
          margin: 2,
        });

        event.qrCode = {
          token,
          dataUrl,
          expiresAt,
          occurrenceDate: occurrence.startDate,
        };
        event.updatedAt = new Date();
        await event.save();

        console.log(`QR refreshed for recurring event "${event.title}" — occurrence ${occurrence.startDate.toISOString()}`);
      } catch (err) {
        console.error(`Failed to refresh QR for event ${event._id}:`, err);
      }
    }
  } catch (error) {
    console.error('Recurring QR job error:', error);
  }
}

export function startRecurringQRJob() {
  // Run immediately on startup
  refreshRecurringQRCodes();
  // Then every 30 minutes
  setInterval(refreshRecurringQRCodes, INTERVAL_MS);
  console.log('Recurring QR job started (every 30 minutes)');
}
