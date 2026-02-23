import mongoose from 'mongoose';

const userBranchSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  branchId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Branch',
    required: true,
  },
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

userBranchSchema.index({ userId: 1, branchId: 1 }, { unique: true });
userBranchSchema.index({ userId: 1, organizationId: 1 });
userBranchSchema.index({ branchId: 1 });

export default mongoose.model('UserBranch', userBranchSchema);
