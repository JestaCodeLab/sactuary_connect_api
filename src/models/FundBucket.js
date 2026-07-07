import mongoose from 'mongoose';

const fundBucketSchema = new mongoose.Schema({
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
  },
  branchId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Branch',
    default: null, // null = org-wide (legacy onboarding-created buckets)
  },
  name: {
    type: String,
    required: true,
  },
  description: String,
  enabled: {
    type: Boolean,
    default: true,
  },
  // Fundraising goal (used when this bucket is presented as a "Project")
  targetAmount: {
    type: Number,
    default: null,
  },
  targetDate: {
    type: Date,
    default: null,
  },
  status: {
    type: String,
    enum: ['active', 'completed', 'archived'],
    default: 'active',
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

fundBucketSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

fundBucketSchema.index({ organizationId: 1, branchId: 1 });

export default mongoose.model('FundBucket', fundBucketSchema);
