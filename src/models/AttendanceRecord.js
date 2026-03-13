import mongoose from 'mongoose';

const attendanceRecordSchema = new mongoose.Schema({
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
  },
  branchId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Branch',
    required: true,
  },
  eventId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Event',
    required: true,
  },
  memberId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Member',
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  checkInMethod: {
    type: String,
    enum: ['qr', 'manual', 'guest'],
    default: 'manual',
  },
  name: String, // For guest check-ins
  email: String, // For guest check-ins
  phone: String, // For guest check-ins
  checkInTime: {
    type: Date,
    default: Date.now,
  },
  occurrenceDate: Date,
  notes: String,
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

attendanceRecordSchema.index({ organizationId: 1, branchId: 1, eventId: 1 });
attendanceRecordSchema.index({ eventId: 1, memberId: 1 });
attendanceRecordSchema.index({ eventId: 1, checkInTime: 1 });
attendanceRecordSchema.index({ eventId: 1, occurrenceDate: 1, memberId: 1 });

export default mongoose.model('AttendanceRecord', attendanceRecordSchema);
