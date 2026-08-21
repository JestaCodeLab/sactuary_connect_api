import mongoose from 'mongoose';

const smsCreditSchema = new mongoose.Schema({
  merchantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
    unique: true
  },
  balance: {
    type: Number,
    required: true,
    default: 0,
    min: 0
  },
  totalPurchased: {
    type: Number,
    default: 0,
    min: 0
  },
  totalUsed: {
    type: Number,
    default: 0,
    min: 0
  },
  lastPurchase: {
    amount: Number,
    date: Date,
    transactionId: String
  },
  transactions: [{
    type: {
      type: String,
      enum: ['purchase', 'usage', 'refund', 'bonus'],
      required: true
    },
    amount: {
      type: Number,
      required: true
    },
    balance: {
      type: Number,
      required: true
    },
    description: String,
    reference: String,
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  autoRecharge: {
    enabled: {
      type: Boolean,
      default: false
    },
    threshold: {
      type: Number,
      default: 100
    },
    amount: {
      type: Number,
      default: 1000
    }
  }
}, {
  timestamps: true
});

// Method to add credits. Uses an atomic $inc (via aggregation-pipeline update)
// rather than read-modify-write, so two concurrent calls (e.g. a purchase and
// a plan-renewal bonus landing at the same time) can't lose one increment.
smsCreditSchema.methods.addCredits = async function(amount, type = 'purchase', description = '', reference = '') {
  const setStage = {
    balance: { $add: ['$balance', amount] },
    totalPurchased: { $add: ['$totalPurchased', amount] },
  };
  if (type === 'purchase') {
    setStage.lastPurchase = { amount, date: new Date(), transactionId: reference };
  }

  const updated = await this.constructor.findOneAndUpdate(
    { _id: this._id },
    [
      { $set: setStage },
      {
        $set: {
          transactions: {
            $concatArrays: [
              '$transactions',
              [{ type, amount, balance: '$balance', description, reference, createdAt: new Date() }],
            ],
          },
        },
      },
    ],
    { new: true }
  );

  Object.assign(this, updated.toObject());
  return this;
};

// Method to deduct credits. Atomic conditional decrement (balance >= amount
// is enforced by the DB, not by a prior read), so two concurrent sends racing
// against a low balance can't both pass the check and drive it negative.
smsCreditSchema.methods.deductCredits = async function(amount, description = '', reference = '') {
  const updated = await this.constructor.findOneAndUpdate(
    { _id: this._id, balance: { $gte: amount } },
    [
      {
        $set: {
          balance: { $subtract: ['$balance', amount] },
          totalUsed: { $add: ['$totalUsed', amount] },
        },
      },
      {
        $set: {
          transactions: {
            $concatArrays: [
              '$transactions',
              [{ type: 'usage', amount: -amount, balance: '$balance', description, reference, createdAt: new Date() }],
            ],
          },
        },
      },
    ],
    { new: true }
  );

  if (!updated) {
    throw new Error('Insufficient SMS credits');
  }

  Object.assign(this, updated.toObject());
  return this;
};

// Static method to get or create credit account
smsCreditSchema.statics.getOrCreate = async function(merchantId, initialBalance = 0) {
  let creditAccount = await this.findOne({ merchantId });
  
  if (!creditAccount) {
    creditAccount = await this.create({
      merchantId,
      balance: initialBalance,
      totalPurchased: initialBalance
    });

    if (initialBalance > 0) {
      creditAccount.transactions.push({
        type: 'bonus',
        amount: initialBalance,
        balance: initialBalance,
        description: 'Initial bonus credits',
        createdAt: new Date()
      });
      await creditAccount.save();
    }
  }

  return creditAccount;
};

const SmsCredit = mongoose.model('SmsCredit', smsCreditSchema);

export default SmsCredit;
