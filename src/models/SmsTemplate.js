import mongoose from 'mongoose';

const smsTemplateSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      trim: true,
    },
    category: {
      type: String,
      enum: [
        'general',
        'event_reminder',
        'event_confirmation',
        'birthday',
        'anniversary',
        'first_timer_followup',
        'announcement',
        'invitation',
        'thank_you',
        'other',
      ],
      default: 'general',
    },
    variables: {
      type: [String],
      default: [],
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    usageCount: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

// Index for faster queries
smsTemplateSchema.index({ organizationId: 1, isActive: 1 });
smsTemplateSchema.index({ organizationId: 1, createdAt: -1 });

const SmsTemplate = mongoose.model('SmsTemplate', smsTemplateSchema);

export default SmsTemplate;
