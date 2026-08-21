import cron from 'node-cron';
import Subscription from '../models/Subscription.js';
import Organization from '../models/Organization.js';
import { getPlanById } from '../config/plans.js';
import { sendSubscriptionExpiringEmail, sendSubscriptionExpiredEmail } from '../utils/email.js';
import notificationService from '../services/notificationService.js';

/**
 * Subscription Expiry Notifications
 *
 * Runs daily. Emails (and creates an in-app notification for) the org admin:
 * - 3 days before currentPeriodEnd, once per billing period
 * - once currentPeriodEnd has passed, once per billing period
 *
 * Deliberately does NOT change subscription.status - access enforcement is
 * handled separately by currentPeriodEnd comparisons in requireFeature/
 * checkFeature/isActive. This job is notification-only.
 */

const REMINDER_WINDOW_DAYS = 3;

const renewLink = () => `${process.env.CLIENT_URL || 'https://app.sanctuaryconnect.org'}/dashboard/settings/subscription`;

async function checkExpiringSubscriptions() {
  try {
    console.log('[Subscription Expiry Job] Running expiry check...');

    const now = new Date();
    const reminderCutoff = new Date(now.getTime() + REMINDER_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    // --- 1. Expiring within the reminder window, not yet reminded this period ---
    const expiringSoon = await Subscription.find({
      status: 'active',
      currentPeriodEnd: { $gte: now, $lte: reminderCutoff },
      $expr: {
        $or: [
          { $eq: ['$expiryReminderSentAt', null] },
          { $lt: ['$expiryReminderSentAt', '$currentPeriodStart'] },
        ],
      },
    });

    for (const subscription of expiringSoon) {
      const plan = getPlanById(subscription.planId);
      if (!plan) continue;

      const organization = await Organization.findById(subscription.organizationId).populate('adminId', 'email firstName');
      const admin = organization?.adminId;
      if (!admin?.email) {
        console.warn(`[Subscription Expiry Job] No admin email for org ${subscription.organizationId}, skipping reminder`);
        continue;
      }

      const daysLeft = Math.max(1, Math.ceil((subscription.currentPeriodEnd - now) / (24 * 60 * 60 * 1000)));
      const expiryDateStr = subscription.currentPeriodEnd.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

      const emailSent = await sendSubscriptionExpiringEmail(
        admin.email,
        admin.firstName || 'there',
        organization.churchName,
        plan.name,
        daysLeft,
        expiryDateStr,
        renewLink()
      );

      // In-app notification is created regardless (it can't "fail to deliver"
      // the way an external email send can), but expiryReminderSentAt is only
      // set on email success, so a genuine delivery failure gets retried on
      // the next day's run instead of being silently skipped for the period.
      await notificationService.createNotification(
        admin._id,
        subscription.organizationId,
        'subscription_expiring_soon',
        `⏳ ${plan.name} expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
        `Your ${plan.name} subscription expires on ${expiryDateStr}. Renew to avoid losing access.`,
        {
          priority: 'high',
          channels: { inApp: true },
          relatedModel: 'Subscription',
          relatedModelId: subscription._id,
          actionUrl: '/dashboard/settings/subscription',
        }
      );

      if (emailSent) {
        subscription.expiryReminderSentAt = now;
        await subscription.save();
      }

      console.log(`[Subscription Expiry Job] ${emailSent ? 'Sent' : 'Attempted (email failed, will retry)'} expiring-soon reminder for org ${subscription.organizationId} (${plan.name}, ${daysLeft}d left)`);
    }

    // --- 2. Already past currentPeriodEnd, not yet notified this period ---
    const justExpired = await Subscription.find({
      status: 'active',
      currentPeriodEnd: { $lt: now },
      $expr: {
        $or: [
          { $eq: ['$expiredNotificationSentAt', null] },
          { $lt: ['$expiredNotificationSentAt', '$currentPeriodStart'] },
        ],
      },
    });

    for (const subscription of justExpired) {
      const plan = getPlanById(subscription.planId);
      if (!plan) continue;

      const organization = await Organization.findById(subscription.organizationId).populate('adminId', 'email firstName');
      const admin = organization?.adminId;
      if (!admin?.email) {
        console.warn(`[Subscription Expiry Job] No admin email for org ${subscription.organizationId}, skipping expired notice`);
        continue;
      }

      const emailSent = await sendSubscriptionExpiredEmail(admin.email, admin.firstName || 'there', organization.churchName, plan.name, renewLink());

      await notificationService.createNotification(
        admin._id,
        subscription.organizationId,
        'subscription_expired',
        `⚠️ ${plan.name} subscription expired`,
        `Your ${plan.name} subscription has expired. Renew to restore full access.`,
        {
          priority: 'high',
          channels: { inApp: true },
          relatedModel: 'Subscription',
          relatedModelId: subscription._id,
          actionUrl: '/dashboard/settings/subscription',
        }
      );

      if (emailSent) {
        subscription.expiredNotificationSentAt = now;
        await subscription.save();
      }

      console.log(`[Subscription Expiry Job] ${emailSent ? 'Sent' : 'Attempted (email failed, will retry)'} expired notice for org ${subscription.organizationId} (${plan.name})`);
    }

    console.log(`[Subscription Expiry Job] Done - ${expiringSoon.length} reminder(s), ${justExpired.length} expired notice(s)`);
  } catch (error) {
    console.error('[Subscription Expiry Job] Error:', error);
  }
}

/**
 * Initialize subscription expiry notification job
 * Runs every day at 8:30 AM
 */
export function initSubscriptionExpiryJob() {
  const schedule = '30 8 * * *';

  console.log('[Subscription Expiry Job] Initializing (8:30 AM daily)');

  cron.schedule(schedule, () => {
    console.log('[Subscription Expiry Job] Triggered at', new Date().toISOString());
    checkExpiringSubscriptions();
  }, {
    timezone: 'Africa/Accra',
  });

  console.log('[Subscription Expiry Job] Scheduled successfully');
}

export { checkExpiringSubscriptions };
