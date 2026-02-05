import mongoose from 'mongoose';

const donationSchema = new mongoose.Schema({
  donorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  amount: {
    type: Number,
    required: true,
  },
  donationType: String,
  donationDate: {
    type: Date,
    required: true,
  },
  paymentMethod: String,
  transactionId: String,
  notes: String,
  fundBucketId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FundBucket',
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

export default mongoose.model('Donation', donationSchema);
