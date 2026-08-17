import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema({
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  type: {
    type: String,
    enum: [
      // Subscriptions
      'subscription_renewal_failed',
      'subscription_cancelled',
      'subscription_upgraded',
      'subscription_downgraded',
      'subscription_trial_ending',
      'subscription_trial_ended',
      'plan_limit_reached',
      'plan_limit_warning',
      'past_due_payment',
      // SMS Payments
      'sms_payment_completed',
      'sms_payment_failed',
      'low_sms_credits',
      // Donations
      'donation_received',
      'large_donation_received',
      // Shepherd Alerts
      'shepherd_alert_triggered',
      // Finance KYC
      'finance_account_approved',
      'finance_account_rejected',
      'finance_account_revoked',
      // Events
      'event_cancelled',
      'event_reminder',
      'low_attendance_alert',
      'event_created',
      'event_updated',
      // Authentication
      'email_verification_needed',
      'password_reset_requested',
      'password_changed',
      'suspicious_activity',
      'account_created',
    ],
    required: true,
  },
  title: {
    type: String,
    required: true,
  },
  message: {
    type: String,
    required: true,
  },
  data: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  read: {
    type: Boolean,
    default: false,
  },
  readAt: Date,
  channels: {
    inApp: {
      type: Boolean,
      default: true,
    },
    sms: {
      type: Boolean,
      default: false,
    },
    email: {
      type: Boolean,
      default: false,
    },
  },
  deliveryStatus: {
    inApp: {
      type: String,
      enum: ['pending', 'sent', 'failed'],
      default: 'pending',
    },
    sms: {
      type: String,
      enum: ['pending', 'sent', 'failed', 'skipped'],
      default: 'skipped',
    },
    email: {
      type: String,
      enum: ['pending', 'sent', 'failed', 'skipped'],
      default: 'skipped',
    },
  },
  relatedModel: String, // e.g., 'Subscription', 'SmsPayment', 'Donation'
  relatedModelId: mongoose.Schema.Types.ObjectId,
  priority: {
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'medium',
  },
  actionUrl: String, // URL to navigate to when notification is clicked
  createdAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
  },
});

// Auto-delete expired notifications
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
notificationSchema.index({ organizationId: 1, userId: 1 });
notificationSchema.index({ organizationId: 1, userId: 1, read: 1 });

export default mongoose.model('Notification', notificationSchema);
