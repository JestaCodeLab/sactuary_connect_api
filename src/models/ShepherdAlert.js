import mongoose from 'mongoose';

/**
 * ShepherdAlert Model
 * Defines rules for automated attendance monitoring and SMS alerts
 * 
 * Features:
 * - Monitor member attendance for specific events
 * - Configurable absence threshold (default: 3)
 * - Multiple shepherd recipients per alert
 * - Track absences per member per event
 */

const shepherdAlertSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
    },
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      required: false, // Can be organization-wide if not set
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: '',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // Which events to monitor
    monitoredEventIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Event',
      },
    ],
    // SMS alert recipients (shepherds/leaders)
    alertRecipients: [
      {
        memberId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Member',
          required: true,
        },
        phoneNumber: {
          type: String,
          required: true,
        },
        role: {
          type: String,
          enum: ['shepherd', 'leader', 'admin'],
          default: 'shepherd',
        },
      },
    ],
    // Threshold configuration
    absenceThreshold: {
      type: Number,
      default: 3,
      min: 1,
      max: 10,
    },
    // Time period for counting absences (in days)
    lookbackPeriodDays: {
      type: Number,
      default: 30,
    },
    // SMS template for alerts
    smsTemplate: {
      type: String,
      default: '{memberName} has been absent from {eventName} {absenceCount} times in the past {lookbackPeriodDays} days.',
    },
    // Last time this alert ran
    lastCheckAt: {
      type: Date,
      default: null,
    },
    // Configuration for when to run checks
    checkSchedule: {
      type: String,
      enum: ['daily', 'weekly', 'manual'],
      default: 'weekly',
    },
    checkDayOfWeek: {
      type: Number,
      min: 0,
      max: 6,
      default: 5, // Friday
    },
    // Stats
    totalAlertsTriggered: {
      type: Number,
      default: 0,
    },
    smsSentCount: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

// Index for efficient queries
shepherdAlertSchema.index({ organizationId: 1, isActive: 1 });
shepherdAlertSchema.index({ organizationId: 1, branchId: 1 });
shepherdAlertSchema.index({ lastCheckAt: 1 });

export default mongoose.model('ShepherdAlert', shepherdAlertSchema);
