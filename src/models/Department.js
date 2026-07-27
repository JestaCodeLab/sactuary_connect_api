import mongoose from 'mongoose';

const departmentSchema = new mongoose.Schema({
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
  },
  branchId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Branch',
    required: true,
  },
  name: {
    type: String,
    required: true,
  },
  description: String,
  leaderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  tags: [{
    type: String,
    trim: true,
  }],
  members: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Member',
  }],
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

departmentSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

departmentSchema.index({ organizationId: 1 });
departmentSchema.index({ branchId: 1 });

export default mongoose.model('Department', departmentSchema);
