import mongoose from 'mongoose';

const platformConfigSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, trim: true },
    value: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

platformConfigSchema.statics.get = async function (key) {
  const doc = await this.findOne({ key });
  return doc ? doc.value : null;
};

platformConfigSchema.statics.set = async function (key, value) {
  await this.findOneAndUpdate({ key }, { value }, { upsert: true, new: true });
};

const PlatformConfig = mongoose.model('PlatformConfig', platformConfigSchema);

export default PlatformConfig;
