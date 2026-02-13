import mongoose from 'mongoose';

const memberSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  firstName: {
    type: String,
    required: true,
  },
  lastName: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
  },
  phone: String,
  dateOfBirth: Date,
  gender: String,
  maritalStatus: String,
  address: String,
  city: String,
  suburb: String,
  region: String,
  zipCode: String,
  country: String,
  baptismDate: Date,
  membershipDate: Date,
  memberStatus: {
    type: String,
    enum: ['active', 'inactive', 'visiting', 'transferred'],
    default: 'active',
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

export default mongoose.model('Member', memberSchema);
