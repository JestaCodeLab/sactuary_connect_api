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
  // How this donation's giver is identified: a registered member, a
  // free-text guest, or an uncounted collective (e.g. a Sunday service or
  // Tuesday prayer meeting offering basket with no individual attribution).
  donorType: {
    type: String,
    enum: ['member', 'guest', 'collective'],
    default: 'member',
  },
  // Free-text donor info for guest givers, or a description of the
  // gathering for collective offerings (e.g. "Sunday Service")
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
  // Cheque number, required by the client when paymentMethod is 'cheque'
  chequeNumber: String,
  // Proof-of-transfer attachment, required by the client when paymentMethod is 'bank_transfer'
  paymentAttachmentUrl: String,
  paymentAttachmentName: String,
  // The month this tithe covers, 'YYYY-MM' (distinct from donationDate,
  // which is when it was actually paid — a tithe paid in Feb may cover Jan)
  paidForMonth: String,
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
