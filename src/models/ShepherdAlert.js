import mongoose from 'mongoose';

/**
 * ShepherdAlert Model (Simplified)
 * Monitors ALL organization members for attendance and sends alerts to shepherds when thresholds are exceeded
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
    },
    // Alert name
    name: {
      type: String,
      required: true,
      trim: true,
    },
    // Is this alert active
    isActive: {
      type: Boolean,
      default: true,
    },
    // Shepherds/leaders to notify when threshold is met
    shepherds: [
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
      },
    ],
    // Events (services) whose attendance this alert measures. Empty = every
    // event in the branch, which lumps midweek meetings (e.g. a Tuesday
    // prayer service) in with Sunday and inflates absence counts.
    eventIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Event',
      },
    ],
    // Absence threshold (e.g., 3 absences)
    absenceThreshold: {
      type: Number,
      default: 3,
      min: 1,
      max: 10,
    },
    // Look back period in days (e.g., 30 days)
    lookbackPeriodDays: {
      type: Number,
      default: 30,
    },
    // Last time this alert ran
    lastCheckAt: {
      type: Date,
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
shepherdAlertSchema.index({ lastCheckAt: 1 });

export default mongoose.model('ShepherdAlert', shepherdAlertSchema);
