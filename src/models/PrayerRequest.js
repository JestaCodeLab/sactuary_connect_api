import mongoose from 'mongoose';

const prayerRequestSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    required: true,
  },
  category: {
    type: String,
    enum: ['health', 'family', 'financial', 'spiritual', 'other'],
    default: 'other',
  },
  status: {
    type: String,
    enum: ['active', 'answered'],
    default: 'active',
  },
  isAnonymous: {
    type: Boolean,
    default: false,
  },
  authorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  authorName: String,
  prayerCount: {
    type: Number,
    default: 0,
  },
  prayedByUsers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }],
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

export default mongoose.model('PrayerRequest', prayerRequestSchema);
