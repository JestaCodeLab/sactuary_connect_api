import mongoose from 'mongoose';

const replySchema = new mongoose.Schema({
  authorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  // Snapshotted rather than always populated live - superadmins aren't
  // members of the org, so there's no single-tenant query that could
  // populate both sides of a conversation cheaply, and a name shouldn't
  // change retroactively if the author is later renamed/removed.
  authorName: {
    type: String,
    required: true,
  },
  authorRole: {
    type: String,
    enum: ['org', 'superadmin'],
    required: true,
  },
  message: {
    type: String,
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
}, { _id: false });

const supportTicketSchema = new mongoose.Schema({
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  type: {
    type: String,
    enum: ['support', 'feature_request'],
    required: true,
  },
  subject: {
    type: String,
    required: true,
    trim: true,
  },
  description: {
    type: String,
    required: true,
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'medium',
  },
  status: {
    type: String,
    enum: ['open', 'in_progress', 'resolved', 'closed'],
    default: 'open',
  },
  replies: {
    type: [replySchema],
    default: [],
  },
}, {
  timestamps: true,
});

supportTicketSchema.index({ organizationId: 1, createdAt: -1 });
supportTicketSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model('SupportTicket', supportTicketSchema);
