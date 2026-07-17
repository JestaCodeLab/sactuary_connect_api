import mongoose from 'mongoose';

const donationSchema = new mongoose.Schema({
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
  },
  branchId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Branch',
  },
  donorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Member',
  },
  // Free-text donor info for public/guest givers who aren't a registered User
  donorName: String,
  donorEmail: String,
  donorPhone: String,
  amount: {
    type: Number,
    required: true,
  },
  donationType: String,
  donationDate: {
    type: Date,
    required: true,
  },
  paymentMethod: String,
  transactionId: String,
  notes: String,
  fundBucketId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FundBucket',
  },
  offeringTypeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'OfferingType',
  },
  // The service/event this offering was collected at, if applicable
  eventId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Event',
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

donationSchema.index({ organizationId: 1, branchId: 1 });

export default mongoose.model('Donation', donationSchema);
