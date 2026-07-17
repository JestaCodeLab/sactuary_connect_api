import mongoose from 'mongoose';

const projectGroupSchema = new mongoose.Schema({
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  },
  branchId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Branch',
    required: true,
    index: true,
  },
  name: {
    type: String,
    required: true,
  },
  isDefault: {
    type: Boolean,
    default: false,
  },
  enabled: {
    type: Boolean,
    default: true,
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

projectGroupSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

projectGroupSchema.index({ organizationId: 1, branchId: 1 });

export default mongoose.model('ProjectGroup', projectGroupSchema);
