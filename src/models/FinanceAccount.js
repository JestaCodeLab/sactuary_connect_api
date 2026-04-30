import mongoose from 'mongoose';

const financeAccountSchema = new mongoose.Schema({
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  },
  
  // Status tracking
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'revoked'],
    default: 'pending',
    index: true,
  },
  
  // Submission metadata
  submittedAt: {
    type: Date,
    default: Date.now,
  },
  submittedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  
  // Approval metadata
  approvedAt: Date,
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  
  // Rejection metadata
  rejectionReason: String,
  rejectionDetails: String,
  
  // Revocation metadata (for compliance/compliance issues)
  revokedAt: Date,
  revokedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  revokedReason: String,
  
  // === BUSINESS KYC FIELDS ===
  businessName: {
    type: String,
    required: true,
  },
  businessType: {
    type: String,
    enum: ['sole_proprietorship', 'partnership', 'llc', 'nonprofit', 'other'],
    required: true,
  },
  businessRegistration: {
    type: String,
    required: true,
  },
  businessRegistrationDoc: {
    type: String, // S3 URL
    required: true,
  },
  businessAddress: {
    type: String,
    required: true,
  },
  taxId: {
    type: String,
    required: true,
  },
  taxIdDoc: {
    type: String, // S3 URL
    required: true,
  },
  
  // === OWNER/PRINCIPAL DETAILS ===
  ownerFullName: {
    type: String,
    required: true,
  },
  ownerEmail: {
    type: String,
    required: true,
  },
  ownerPhone: {
    type: String,
    required: true,
  },
  ownerIdType: {
    type: String,
    enum: ['national_id', 'passport', 'drivers_license', 'other'],
    required: true,
  },
  ownerIdNumber: {
    type: String,
    required: true,
  },
  ownerIdDoc: {
    type: String, // S3 URL
    required: true,
  },
  
  // === PAYSTACK ACCOUNT FIELDS ===
  bankCode: {
    type: String,
    required: true,
  },
  bankAccountName: {
    type: String,
    required: true,
  },
  bankAccountNumber: {
    type: String,
    required: true,
  },
  accountType: {
    type: String,
    enum: ['individual', 'business'],
    required: true,
  },
  
  // Paystack response fields (populated after approval)
  paystackMerchantId: String,
  paystackAuthorizationUrl: String,
  paystackLiveMode: {
    type: Boolean,
    default: false,
  },
  
  // Audit trail - track all status changes
  statusHistory: [
    {
      status: String,
      changedAt: {
        type: Date,
        default: Date.now,
      },
      changedBy: mongoose.Schema.Types.ObjectId,
      notes: String,
    },
  ],
  
  createdAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Index for common queries
financeAccountSchema.index({ organizationId: 1, status: 1 });
financeAccountSchema.index({ status: 1, submittedAt: -1 });
financeAccountSchema.index({ createdAt: -1 });

// Pre-save hook to update updatedAt and statusHistory
financeAccountSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

export default mongoose.model('FinanceAccount', financeAccountSchema);
