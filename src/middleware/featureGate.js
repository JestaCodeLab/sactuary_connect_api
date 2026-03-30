import Organization from '../models/Organization.js';
import Subscription from '../models/Subscription.js';
import { PLANS } from '../config/plans.js';

/**
 * Returns the minimum plan that includes a given feature key.
 */
const getMinimumPlan = (featureKey) => {
  const planOrder = ['seed', 'growth', 'ascend', 'sanctuary'];
  for (const planId of planOrder) {
    const plan = PLANS[planId];
    const feature = plan.features.find(f => f.key === featureKey);
    if (feature?.included) return planId;
  }
  return 'sanctuary';
};

/**
 * Middleware to gate routes by subscription feature.
 * Must be used after authenticateToken middleware.
 *
 * Usage: router.get('/path', authenticateToken, requireFeature('feature_key'), handler)
 * 
 * TEMPORARILY DISABLED: Feature gating is disabled for development/debugging
 */
export const requireFeature = (featureKey) => {
  return async (req, res, next) => {
    // TEMPORARILY DISABLED - allow all requests through
    console.log(`[FeatureGate] DISABLED - bypassing feature check for "${featureKey}"`);
    next();
  };
};

export default { requireFeature };
