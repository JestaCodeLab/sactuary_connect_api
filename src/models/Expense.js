import mongoose from 'mongoose';

const expenseSchema = new mongoose.Schema({
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
  },
  amount: {
    type: Number,
    required: true,
  },
  branchId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Branch',
  },
  // Legacy free-text category, kept as a display fallback for records created
  // before ExpenseCategory existed. New records should set categoryId.
  category: {
    type: String,
    required: true,
  },
  categoryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ExpenseCategory',
  },
  description: String,
  date: {
    type: Date,
    required: true,
  },
  vendor: String,
  receiptUrl: String,
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
  },
  submittedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  approvedAt: Date,
  rejectionReason: String,
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
  paymentMethod: String,
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

expenseSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

expenseSchema.index({ organizationId: 1, branchId: 1 });
expenseSchema.index({ date: -1 });
expenseSchema.index({ status: 1 });

export default mongoose.model('Expense', expenseSchema);
