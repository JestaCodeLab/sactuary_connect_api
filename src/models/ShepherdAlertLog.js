import mongoose from 'mongoose';

/**
 * ShepherdAlertLog Model
 * Tracks every time a Shepherd Alert is checked and triggered
 * Provides audit trail and analytics for the alert system
 */

const shepherdAlertLogSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
    },
    shepherdAlertId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ShepherdAlert',
      required: true,
    },
    // Member being monitored
    memberId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Member',
      required: true,
    },
    memberName: {
      type: String,
      required: true,
    },
    memberPhone: {
      type: String,
    },
    // Event this is related to
    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Event',
    },
    eventName: {
      type: String,
    },
    // Attendance data
    absenceCount: {
      type: Number,
      required: true,
    },
    absenceThreshold: {
      type: Number,
      required: true,
    },
    lookbackPeriodDays: {
      type: Number,
      required: true,
    },
    // Was alert triggered?
    triggerred: {
      type: Boolean,
      default: false,
    },
    // SMS details
    smsAttempted: {
      type: Boolean,
      default: false,
    },
    smsSent: {
      type: Boolean,
      default: false,
    },
    smsMessage: {
      type: String,
    },
    smsReference: {
      type: String, // Reference from SMS provider
    },
    // Recipients who were sent SMS
    recipientsNotified: [
      {
        memberId: mongoose.Schema.Types.ObjectId,
        phoneNumber: String,
        status: {
          type: String,
          enum: ['pending', 'sent', 'failed'],
        },
      },
    ],
    // Period this check covers
    checkPeriodStart: {
      type: Date,
      required: true,
    },
    checkPeriodEnd: {
      type: Date,
      required: true,
    },
    // Error message if something went wrong
    error: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
shepherdAlertLogSchema.index({ organizationId: 1, createdAt: -1 });
shepherdAlertLogSchema.index({ shepherdAlertId: 1, createdAt: -1 });
shepherdAlertLogSchema.index({ memberId: 1, createdAt: -1 });
shepherdAlertLogSchema.index({ triggerred: 1 });
shepherdAlertLogSchema.index({ smsSent: 1 });

export default mongoose.model('ShepherdAlertLog', shepherdAlertLogSchema);
