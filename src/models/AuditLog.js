import mongoose from 'mongoose';

const auditLogSchema = new mongoose.Schema({
  actorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  action: {
    type: String,
    required: true,
    // e.g. 'suspend_org', 'change_plan', 'add_sms_credits', 'create_superadmin'
  },
  targetOrgId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    default: null,
  },
  targetUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  details: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
    // Stores before/after values or action-specific payload
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

auditLogSchema.index({ actorId: 1 });
auditLogSchema.index({ targetOrgId: 1 });
auditLogSchema.index({ createdAt: -1 });

export default mongoose.model('AuditLog', auditLogSchema);
