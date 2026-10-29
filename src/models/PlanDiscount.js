import mongoose from 'mongoose';

/**
 * Superadmin-managed discount on a subscription plan's list price.
 * Applied at quote time (see services/pricingService.js); never stored on the
 * plan itself, so ending/deactivating a discount simply restores list price
 * for the next charge. Subscriptions keep priceAtSubscription for history.
 */
const planDiscountSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    // A specific paid plan id, or 'all' for every paid plan.
    planId: { type: String, required: true, default: 'all' },
    // Which billing cycle the discount applies to.
    billingCycle: {
      type: String,
      enum: ['monthly', 'annual', 'both'],
      required: true,
      default: 'annual',
    },
    type: { type: String, enum: ['percent', 'fixed'], required: true, default: 'percent' },
    // percent: 0 < value <= 100 ; fixed: GHS amount off the cycle's list price
    value: { type: Number, required: true, min: 0 },
    isActive: { type: Boolean, default: true },
    startsAt: Date,
    endsAt: Date,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

planDiscountSchema.index({ isActive: 1, planId: 1 });

export default mongoose.model('PlanDiscount', planDiscountSchema);
