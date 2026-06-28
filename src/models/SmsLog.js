import mongoose from 'mongoose';

const recipientSchema = new mongoose.Schema({
  phoneNumber: {
    type: String,
    required: true
  },
  name: String,
  memberId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Member'
  },
  status: {
    type: String,
    enum: ['pending', 'submitted', 'delivered', 'failed', 'undelivered'],
    default: 'pending'
  },
  sentAt: Date,
  deliveredAt: Date,
  failureReason: String,
  providerMessageId: String,
  deliveryReport: String
}, { _id: true });

const smsLogSchema = new mongoose.Schema({
  merchantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true
  },
  sentBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },
  messageType: {
    type: String,
    enum: ['single', 'bulk', 'scheduled'],
    required: true
  },
  category: {
    type: String,
    enum: [
      'welcome',
      'event_reminder',
      'event_confirmation',
      'birthday',
      'anniversary',
      'first_timer_followup',
      'announcement',
      'invitation',
      'thank_you',
      'general',
      'event',
      'reminder',
      'emergency',
      'other'
    ],
    default: 'general'
  },
  recipients: [recipientSchema],
  message: {
    type: String,
    required: true
  },
  senderID: {
    type: String,
    required: true
  },
  templateUsed: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SmsTemplate'
  },
  creditsUsed: {
    type: Number,
    required: true,
    default: 0
  },
  bmscampaignId: String,
  overallStatus: {
    type: String,
    enum: ['pending', 'processing', 'submitted', 'delivered', 'failed', 'partial'],
    default: 'pending'
  },
  totalRecipients: {
    type: Number,
    required: true
  },
  successfulDeliveries: {
    type: Number,
    default: 0
  },
  failedDeliveries: {
    type: Number,
    default: 0
  },
  pendingDeliveries: {
    type: Number,
    default: 0
  },
  targetGroup: {
    type: String,
    enum: ['individual', 'department', 'branch', 'all_members', 'custom']
  },
  targetGroupDetails: {
    departmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Department'
    },
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch'
    }
  },
  scheduledFor: Date,
  metadata: {
    type: Map,
    of: mongoose.Schema.Types.Mixed
  },
  isPersonalized: {
    type: Boolean,
    default: false
  },
  errors: [{
    message: String,
    code: String,
    timestamp: Date,
    response: String
  }]
}, {
  timestamps: true
});

// Indexes for better query performance
smsLogSchema.index({ merchantId: 1, createdAt: -1 });
smsLogSchema.index({ sentBy: 1, createdAt: -1 });
smsLogSchema.index({ overallStatus: 1 });
smsLogSchema.index({ 'recipients.status': 1 });
smsLogSchema.index({ category: 1 });

// Virtual for delivery rate
smsLogSchema.virtual('deliveryRate').get(function() {
  if (this.totalRecipients === 0) return 0;
  return (this.successfulDeliveries / this.totalRecipients) * 100;
});

// Method to update recipient status
smsLogSchema.methods.updateRecipientStatus = async function(phoneNumber, status, additionalData = {}) {
  const recipient = this.recipients.find(r => r.phoneNumber === phoneNumber);
  
  if (recipient) {
    recipient.status = status;
    
    if (status === 'delivered') {
      recipient.deliveredAt = new Date();
      this.successfulDeliveries = (this.successfulDeliveries || 0) + 1;
    } else if (status === 'failed' || status === 'undelivered') {
      this.failedDeliveries = (this.failedDeliveries || 0) + 1;
      if (additionalData.failureReason) {
        recipient.failureReason = additionalData.failureReason;
      }
    }

    if (additionalData.providerMessageId) {
      recipient.providerMessageId = additionalData.providerMessageId;
    }

    if (additionalData.deliveryReport) {
      recipient.deliveryReport = additionalData.deliveryReport;
    }

    // Update overall status
    const statuses = this.recipients.map(r => r.status);
    if (statuses.every(s => s === 'delivered')) {
      this.overallStatus = 'delivered';
    } else if (statuses.every(s => s === 'failed' || s === 'undelivered')) {
      this.overallStatus = 'failed';
    } else if (statuses.some(s => s === 'delivered') && statuses.some(s => s === 'failed' || s === 'undelivered')) {
      this.overallStatus = 'partial';
    }

    await this.save();
  }

  return this;
};

// Method to get delivery statistics
smsLogSchema.methods.getStats = function() {
  const stats = {
    total: this.totalRecipients,
    delivered: 0,
    failed: 0,
    pending: 0,
    submitted: 0
  };

  this.recipients.forEach(recipient => {
    if (recipient.status === 'delivered') stats.delivered++;
    else if (recipient.status === 'failed' || recipient.status === 'undelivered') stats.failed++;
    else if (recipient.status === 'pending') stats.pending++;
    else if (recipient.status === 'submitted') stats.submitted++;
  });

  stats.deliveryRate = stats.total > 0 ? (stats.delivered / stats.total) * 100 : 0;

  return stats;
};

const SmsLog = mongoose.model('SmsLog', smsLogSchema);

export default SmsLog;
