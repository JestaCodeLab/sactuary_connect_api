import mongoose from 'mongoose';

const organizationSchema = new mongoose.Schema({
  churchName: {
    type: String,
    required: true,
  },
  legalName: String,
  logoUrl: String,
  structure: {
    type: String,
    enum: ['single', 'multi'],
    default: 'single',
  },
  currency: {
    type: String,
    default: 'GHS',
  },
  paymentGateway: String,
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  subscriptionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subscription',
  },
  // Onboarding status
  onboardingComplete: {
    type: Boolean,
    default: false,
  },
  onboardingStep: {
    type: Number,
    default: 1,
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
organizationSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Index for efficient queries
organizationSchema.index({ adminId: 1 });
organizationSchema.index({ subscriptionId: 1 });

export default mongoose.model('Organization', organizationSchema);
