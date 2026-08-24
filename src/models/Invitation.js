import mongoose from 'mongoose';

const invitationSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
    role: { type: String, enum: ['admin', 'pastor', 'staff', 'member', 'custom'], default: 'admin' },
    customRoleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Role', default: null },
    branchIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Branch' }],
    departmentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Department' }],
    token: { type: String, required: true, unique: true },
    status: { type: String, enum: ['pending', 'accepted', 'revoked'], default: 'pending' },
    expiresAt: { type: Date, required: true },
    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

invitationSchema.index({ organizationId: 1, email: 1, status: 1 });
invitationSchema.index({ token: 1 });
invitationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model('Invitation', invitationSchema);
