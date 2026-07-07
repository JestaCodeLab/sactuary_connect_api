import mongoose from 'mongoose';

const financeAccountSchema = new mongoose.Schema({
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
  // 'primary' = the org's one full-KYC merchant account (real Paystack keys).
  // 'subaccount' = a branch account created self-service under the primary's
  // own Paystack keys, settling to its own bank account.
  tier: {
    type: String,
    enum: ['primary', 'subaccount'],
    required: true,
  },

  // Status tracking (manual-review lifecycle — primary only; subaccounts are
  // created directly as 'approved' since Paystack validates the bank account)
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

  // Revocation metadata (for compliance issues)
  revokedAt: Date,
  revokedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  revokedReason: String,

  // === BUSINESS KYC FIELDS (primary only) ===
  businessName: String,
  businessType: {
    type: String,
    enum: ['sole_proprietorship', 'partnership', 'llc', 'nonprofit', 'other'],
  },
  businessRegistration: String,
  businessRegistrationDoc: String, // Cloudinary URL
  businessAddress: String,

  // === OWNER/PRINCIPAL DETAILS (primary only) ===
  ownerFullName: String,
  ownerEmail: String,
  ownerPhone: String,
  ownerIdType: {
    type: String,
    enum: ['national_id', 'passport', 'drivers_license', 'other'],
  },
  ownerIdNumber: String,
  ownerIdDoc: String, // Cloudinary URL

  // === BANK DETAILS (primary only — settlement account for the primary Paystack business) ===
  bankCode: String,
  bankAccountName: String,
  bankAccountNumber: String,
  bankAccountType: {
    type: String,
    enum: ['individual', 'business'],
  },

  // === PAYSTACK KEYS (primary only — entered by superadmin after off-platform verification) ===
  paystackSecretKey: String, // encrypted
  paystackPublicKey: String, // plaintext (safe client-side)
  paystackKeysAddedAt: Date,
  paystackKeysAddedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },

  // === SUBACCOUNT FIELDS (subaccount tier only) ===
  paystackSubaccountCode: String,
  subaccountBankCode: String,
  subaccountBankAccountName: String,
  subaccountBankAccountNumber: String,
  subaccountCreatedAt: Date,
  subaccountCreatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
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

// One finance account per branch
financeAccountSchema.index({ organizationId: 1, branchId: 1 }, { unique: true });
financeAccountSchema.index({ organizationId: 1, tier: 1 });
financeAccountSchema.index({ status: 1, submittedAt: -1 });
financeAccountSchema.index({ createdAt: -1 });

financeAccountSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

export default mongoose.model('FinanceAccount', financeAccountSchema);
