import mongoose from 'mongoose';

const smsPaymentSchema = new mongoose.Schema({
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true
  },
  credits: {
    type: Number,
    required: true,
    min: 1
  },
  amountInGhs: {
    type: Number,
    required: true,
    min: 0.035
  },
  paystackReference: {
    type: String,
    unique: true,
    sparse: true
  },
  paystackCustomerCode: {
    type: String,
    sparse: true
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'verified', 'completed', 'failed', 'cancelled'],
    default: 'pending',
    index: true
  },
  paymentMethod: {
    type: String,
    enum: ['card', 'mobile_money', 'manual'],
    default: 'card'
  },
  channel: {
    type: String,
    enum: ['card', 'mobile_money', 'bank_transfer'],
    sparse: true
  },
  paystackVerification: {
    status: String,
    amount: Number,
    paidAt: Date,
    customerCode: String,
    last4: String,
    brand: String,
    momoProvider: String,
    momoNumber: String
  },
  errorMessage: String,
  ipAddress: String,
  userAgent: String,
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  verifiedAt: Date,
  completedAt: Date
}, {
  timestamps: true
});

// Add index for querying organization payments
smsPaymentSchema.index({ organizationId: 1, createdAt: -1 });

// Add index for Paystack reference lookup
smsPaymentSchema.index({ paystackReference: 1 });

const SmsPayment = mongoose.model('SmsPayment', smsPaymentSchema);

export default SmsPayment;
