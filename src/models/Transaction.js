import mongoose from 'mongoose';

const transactionSchema = new mongoose.Schema({
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
  },
  branchId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Branch',
  },

  // Classification
  type: {
    type: String,
    enum: ['subscription_payment', 'sms_credit_purchase', 'donation', 'expense', 'refund'],
    required: true,
  },
  direction: {
    type: String,
    enum: ['inflow', 'outflow'],
    required: true,
  },

  // Financial
  amount: {
    type: Number,
    required: true,
  },
  subtotal: Number,
  taxAmount: {
    type: Number,
    default: 0,
  },
  taxRate: {
    type: Number,
    default: 0,
  },
  currency: {
    type: String,
    default: 'GHS',
  },

  // Status
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'refunded'],
    default: 'completed',
  },

  // Payment
  paymentMethod: String,
  paymentProvider: String,
  providerReference: String,
  channel: String,

  // Polymorphic reference to source record
  relatedModel: {
    type: String,
    enum: ['Subscription', 'SmsCredit', 'Donation', 'Expense'],
  },
  relatedId: {
    type: mongoose.Schema.Types.ObjectId,
  },

  // Context
  description: {
    type: String,
    required: true,
  },
  initiatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },

  // Type-specific data
  metadata: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
  },
}, { timestamps: true });

// Indexes for efficient queries
transactionSchema.index({ organizationId: 1, createdAt: -1 });
transactionSchema.index({ organizationId: 1, type: 1 });
transactionSchema.index({ organizationId: 1, status: 1 });
transactionSchema.index({ relatedModel: 1, relatedId: 1 });

export default mongoose.model('Transaction', transactionSchema);
