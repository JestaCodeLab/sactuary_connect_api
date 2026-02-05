import mongoose from 'mongoose';

const subscriptionSchema = new mongoose.Schema({
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
    unique: true,
  },
  planId: {
    type: String,
    enum: ['seed', 'growth', 'ascend', 'sanctuary'],
    required: true,
    default: 'seed',
  },
  status: {
    type: String,
    enum: ['active', 'cancelled', 'past_due', 'trialing', 'paused'],
    default: 'active',
  },
  billingCycle: {
    type: String,
    enum: ['monthly', 'annual', 'custom'],
    default: 'monthly',
  },
  currentPeriodStart: {
    type: Date,
    default: Date.now,
  },
  currentPeriodEnd: {
    type: Date,
    required: true,
  },
  cancelAtPeriodEnd: {
    type: Boolean,
    default: false,
  },
  cancelledAt: Date,
  trialEndsAt: Date,

  // Payment info
  paymentMethod: {
    type: String,
    enum: ['card', 'momo', 'bank_transfer', 'manual'],
  },
  paymentDetails: {
    // Masked/partial payment info for display
    last4: String,
    brand: String, // visa, mastercard, mtn, vodafone, etc.
    expiryMonth: Number,
    expiryYear: Number,
    momoProvider: String,
    momoNumber: String, // Masked
  },

  // Billing info
  billingAddress: {
    street: String,
    city: String,
    state: String,
    country: String,
    zipCode: String,
  },

  // Usage tracking
  usage: {
    membersCount: { type: Number, default: 0 },
    branchesCount: { type: Number, default: 0 },
    smsUsed: { type: Number, default: 0 },
    donationTransactions: { type: Number, default: 0 },
    lastResetDate: { type: Date, default: Date.now },
  },

  // Price at time of subscription (in case plan prices change)
  priceAtSubscription: {
    amount: Number,
    currency: { type: String, default: 'GHS' },
  },

  // Metadata
  metadata: {
    type: Map,
    of: String,
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

// Pre-save middleware to update timestamps
subscriptionSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Virtual for checking if subscription is active
subscriptionSchema.virtual('isActive').get(function() {
  return this.status === 'active' || this.status === 'trialing';
});

// Virtual for days remaining in current period
subscriptionSchema.virtual('daysRemaining').get(function() {
  const now = new Date();
  const end = new Date(this.currentPeriodEnd);
  const diff = end - now;
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
});

// Method to check if a feature is available
subscriptionSchema.methods.hasFeature = function(featureKey) {
  const PLANS = require('../config/plans.js').default;
  const plan = PLANS[this.planId];
  if (!plan) return false;

  const feature = plan.features.find(f => f.key === featureKey);
  return feature ? feature.included : false;
};

// Method to check usage limits
subscriptionSchema.methods.checkLimit = function(limitKey, currentValue) {
  const PLANS = require('../config/plans.js').default;
  const plan = PLANS[this.planId];
  if (!plan) return false;

  const limit = plan.limits[limitKey];
  if (limit === -1) return true; // Unlimited
  return currentValue < limit;
};

// Index for efficient queries
subscriptionSchema.index({ organizationId: 1 });
subscriptionSchema.index({ status: 1 });
subscriptionSchema.index({ currentPeriodEnd: 1 });

export default mongoose.model('Subscription', subscriptionSchema);
