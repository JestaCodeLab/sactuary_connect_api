import mongoose from 'mongoose';

const userDepartmentSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  departmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
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

userDepartmentSchema.index({ userId: 1, departmentId: 1 }, { unique: true });
userDepartmentSchema.index({ userId: 1, organizationId: 1 });
userDepartmentSchema.index({ departmentId: 1 });

export default mongoose.model('UserDepartment', userDepartmentSchema);
