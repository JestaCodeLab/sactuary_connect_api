import mongoose from 'mongoose';

const serviceCodeSchema = new mongoose.Schema({
  eventId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Event',
    required: true,
  },
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
  },
  branchId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Branch',
  },
  occurrenceDate: {
    type: Date,
    required: true,
  },
  code: {
    type: String,
    required: true,
  },
  generatedAt: {
    type: Date,
    default: Date.now,
  },
  expiresAt: {
    type: Date,
    required: true,
  },
  usageCount: {
    type: Number,
    default: 0,
  },
});

// Index for efficient queries
serviceCodeSchema.index({ eventId: 1, occurrenceDate: 1 });
serviceCodeSchema.index({ organizationId: 1, occurrenceDate: 1 });
serviceCodeSchema.index({ code: 1 });
serviceCodeSchema.index({ expiresAt: 1 });

export default mongoose.model('ServiceCode', serviceCodeSchema);
