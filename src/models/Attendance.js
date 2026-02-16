import mongoose from 'mongoose';

const attendanceSchema = new mongoose.Schema({
  eventId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Event',
    required: true,
  },
  date: {
    type: Date,
    required: true,
  },
  totalPresent: {
    type: Number,
    default: 0,
  },
  totalAbsent: {
    type: Number,
    default: 0,
  },
  notes: String,
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

export default mongoose.model('Attendance', attendanceSchema);
