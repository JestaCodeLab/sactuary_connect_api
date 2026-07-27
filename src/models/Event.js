import mongoose from 'mongoose';

const eventSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
  },
  description: String,
  eventType: String,
  startDate: {
    type: Date,
    required: true,
  },
  endDate: {
    type: Date,
    required: true,
  },
  location: String,
  organizerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  maxCapacity: Number,
  status: {
    type: String,
    enum: ['scheduled', 'ongoing', 'completed', 'cancelled'],
    default: 'scheduled',
  },
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
  },
  branchId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Branch',
  },
  departmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
  },
  isRecurring: {
    type: Boolean,
    default: false,
  },
  recurrencePattern: {
    type: String,
    enum: ['weekly', 'biweekly', 'monthly'],
  },
  recurrenceDay: {
    type: Number,
    min: 0,
    max: 6,
  },
  recurrenceEndDate: Date,
  shareToken: {
    type: String,
    unique: true,
    sparse: true,
  },
  isPublic: {
    type: Boolean,
    default: false,
  },
  qrCode: {
    token: {
      type: String,
      unique: true,
      sparse: true,
    },
    dataUrl: String,
    expiresAt: Date,
    occurrenceDate: Date, // Only used for non-recurring events
    generatedAt: Date,
  },
  // For recurring events: indicates that service codes are used instead of expiring QR
  usesServiceCodes: {
    type: Boolean,
    default: false, // Set to true automatically if event is recurring
  },
  reminders: [{
    offsetMinutes: {
      type: Number,
      required: true,
      min: 0,
    },
    message: String,
    templateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SmsTemplate',
    },
    // Guards against re-sending the same reminder for the same occurrence
    // (recurring events have a new occurrence to remind about each time).
    lastSentOccurrence: Date,
  }],
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

eventSchema.index({ organizationId: 1, branchId: 1 });

export default mongoose.model('Event', eventSchema);
