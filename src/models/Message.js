import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
  subject: {
    type: String,
    required: true,
  },
  body: {
    type: String,
    required: true,
  },
  recipientType: {
    type: String,
    enum: ['all', 'branch', 'group', 'individual'],
    default: 'all',
  },
  recipientCount: {
    type: Number,
    default: 0,
  },
  channel: {
    type: String,
    enum: ['email', 'sms', 'in-app'],
    required: true,
  },
  status: {
    type: String,
    enum: ['draft', 'sent', 'scheduled'],
    default: 'draft',
  },
  sentAt: Date,
  scheduledAt: Date,
  authorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
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

export default mongoose.model('Message', messageSchema);
