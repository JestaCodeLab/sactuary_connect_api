import cron from 'node-cron';
import Event from '../models/Event.js';
import SmsTemplate from '../models/SmsTemplate.js';
import smsService from '../services/smsService.js';

/**
 * Event SMS Reminders
 *
 * Runs every 15 minutes. For each event with configured reminders, finds the
 * next upcoming occurrence (a single date for non-recurring events, or the
 * next date matching the recurrence pattern) and sends any reminder whose
 * offset window has arrived, guarding against re-sending for the same
 * occurrence via `reminder.lastSentOccurrence`.
 */

// Same recurrence math as client/src/lib/eventOccurrences.ts, ported server-side
// since this needs to run unattended in a cron job rather than in the browser.
function getNextOccurrenceStart(event, now) {
  if (!event.isRecurring || !event.recurrencePattern) {
    return new Date(event.startDate);
  }

  const anchorStart = new Date(event.startDate);
  const seriesEnd = event.recurrenceEndDate ? new Date(event.recurrenceEndDate) : null;

  const current = new Date(anchorStart);
  if (event.recurrenceDay !== undefined && event.recurrenceDay !== null) {
    while (current.getDay() !== event.recurrenceDay) {
      current.setDate(current.getDate() + 1);
    }
    current.setHours(anchorStart.getHours(), anchorStart.getMinutes(), anchorStart.getSeconds(), anchorStart.getMilliseconds());
  }

  const increment = event.recurrencePattern === 'weekly' ? 7 : event.recurrencePattern === 'biweekly' ? 14 : 30;

  // Advance to the next occurrence that hasn't started yet
  while (current < now) {
    if (event.recurrencePattern === 'monthly') {
      current.setMonth(current.getMonth() + 1);
    } else {
      current.setDate(current.getDate() + increment);
    }
  }

  if (seriesEnd && current > seriesEnd) return null; // series has ended
  return current;
}

async function sendEventReminders() {
  console.log('[Event Reminder Job] Checking for due reminders...');
  const now = new Date();

  const events = await Event.find({
    reminders: { $exists: true, $not: { $size: 0 } },
    status: { $in: ['scheduled', 'ongoing'] },
  });

  let totalSent = 0;
  let totalFailed = 0;

  for (const event of events) {
    const nextOccurrenceStart = getNextOccurrenceStart(event, now);
    if (!nextOccurrenceStart) continue; // recurring series has ended

    let eventChanged = false;

    for (const reminder of event.reminders) {
      const sendAt = new Date(nextOccurrenceStart.getTime() - reminder.offsetMinutes * 60000);
      const occurrenceKey = nextOccurrenceStart.toISOString();
      const alreadySent = reminder.lastSentOccurrence && new Date(reminder.lastSentOccurrence).toISOString() === occurrenceKey;

      // Not due yet, already sent for this occurrence, or the occurrence already started
      if (alreadySent || now < sendAt || now >= nextOccurrenceStart) continue;

      try {
        let message = reminder.message;
        if (!message && reminder.templateId) {
          const template = await SmsTemplate.findById(reminder.templateId);
          message = template?.message;
        }

        if (!message) {
          console.warn(`[Event Reminder Job] Reminder on event ${event._id} has no message or valid template, skipping`);
        } else {
          const sendParams = {
            message,
            merchantId: event.organizationId,
            userId: null,
            category: 'event_reminder',
          };

          const result = event.branchId
            ? await smsService.sendToBranch({ ...sendParams, branchId: event.branchId })
            : await smsService.sendToAllMembers(sendParams);

          if (result.success) {
            totalSent++;
            console.log(`[Event Reminder Job] Sent reminder for "${event.title}" (${event._id})`);
          } else {
            totalFailed++;
          }
        }
      } catch (error) {
        totalFailed++;
        console.error(`[Event Reminder Job] Failed to send reminder for event ${event._id}:`, error.message);
      }

      // Mark as attempted regardless of outcome, so a persistent failure (e.g.
      // insufficient credits) doesn't retry every 15 minutes for the same occurrence.
      reminder.lastSentOccurrence = nextOccurrenceStart;
      eventChanged = true;
    }

    if (eventChanged) {
      await event.save();
    }
  }

  console.log(`[Event Reminder Job] Completed - Sent: ${totalSent}, Failed: ${totalFailed}`);
}

/**
 * Initialize event reminder automation job
 * Runs every 15 minutes
 */
export function initEventReminderJob() {
  const schedule = '*/15 * * * *';

  console.log('[Event Reminder Job] Initializing event reminder automation (every 15 minutes)');

  cron.schedule(schedule, () => {
    console.log('[Event Reminder Job] Triggered at', new Date().toISOString());
    sendEventReminders();
  }, {
    timezone: 'Africa/Accra',
  });

  console.log('[Event Reminder Job] Automation scheduled successfully');
}

// Export the manual trigger function for testing
export { sendEventReminders };
