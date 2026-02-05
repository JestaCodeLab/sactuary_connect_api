import mongoose from 'mongoose';

const branchSchema = new mongoose.Schema({
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
  },
  name: {
    type: String,
    required: true,
  },
  address: String,
  city: String,
  state: String,
  zipCode: String,
  latitude: Number,
  longitude: Number,
  geofenceRadius: {
    type: Number,
    default: 100,
  },
  isHeadOffice: {
    type: Boolean,
    default: false,
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

export default mongoose.model('Branch', branchSchema);
