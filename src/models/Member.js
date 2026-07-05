import mongoose from 'mongoose';

const memberSchema = new mongoose.Schema({
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
  },
  branchId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Branch',
  },
  departments: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
    unique: false,
  }],
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  firstName: {
    type: String,
    required: true,
  },
  lastName: {
    type: String,
    required: true,
  },
  email: String,
  phone: {
    type: String,
  },
  dateOfBirth: Date,
  gender: String,
  maritalStatus: String,
  address: String,
  city: String,
  suburb: String,
  region: String,
  zipCode: String,
  country: String,
  baptismDate: Date,
  membershipDate: Date,
  memberStatus: {
    type: String,
    enum: ['active', 'inactive', 'visiting', 'transferred'],
    default: 'active',
  },
  // Family Information
  familyMembers: [{
    memberId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Member',
    },
    relationship: {
      type: String,
      enum: ['mother', 'father', 'spouse', 'child', 'sibling', 'grandparent', 'other'],
    },
  }],
  // Notes
  notes: String,
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

memberSchema.pre('validate', function (next) {
  if (!this.phone) {
    if (!this.dateOfBirth) {
      return next(new Error('Phone number is required'));
    }
    const ageDiffMs = Date.now() - new Date(this.dateOfBirth).getTime();
    const ageYears = ageDiffMs / (1000 * 60 * 60 * 24 * 365.25);
    if (ageYears >= 18) {
      return next(new Error('Phone number is required for members 18 and older'));
    }
  }
  next();
});

memberSchema.index({ organizationId: 1, branchId: 1 });
// Sparse: members without a phone (under-18s) are excluded from this unique constraint
memberSchema.index({ organizationId: 1, phone: 1 }, { unique: true, sparse: true });

export default mongoose.model('Member', memberSchema);
