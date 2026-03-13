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

// Method to add credits
smsCreditSchema.methods.addCredits = async function(amount, type = 'purchase', description = '', reference = '') {
  this.balance += amount;
  this.totalPurchased += amount;
  
  if (type === 'purchase') {
    this.lastPurchase = {
      amount,
      date: new Date(),
      transactionId: reference
    };
  }

  this.transactions.push({
    type,
    amount,
    balance: this.balance,
    description,
    reference,
    createdAt: new Date()
  });

  await this.save();
  return this;
};

// Method to deduct credits
smsCreditSchema.methods.deductCredits = async function(amount, description = '', reference = '') {
  if (this.balance < amount) {
    throw new Error('Insufficient SMS credits');
  }

  this.balance -= amount;
  this.totalUsed += amount;

  this.transactions.push({
    type: 'usage',
    amount: -amount,
    balance: this.balance,
    description,
    reference,
    createdAt: new Date()
  });

  await this.save();
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
