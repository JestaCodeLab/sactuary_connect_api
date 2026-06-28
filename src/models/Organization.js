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
  // Finance account for merchant setup & payment processing
  financeAccountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FinanceAccount',
  },
  // Birthday SMS settings
  birthdayMessageTemplate: {
    type: String,
    default: "Happy Birthday {{firstName}}! 🎉🎂 May God bless you abundantly on your special day. You are loved and cherished. - {{churchName}}",
  },
  birthdayAutoSendEnabled: {
    type: Boolean,
    default: true,
  },
  // SMS Sender ID configuration
  smsConfig: {
    senderId: String,
    senderIdStatus: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending'
    },
    senderIdPurpose: String,
    senderIdRegisteredAt: Date,
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
