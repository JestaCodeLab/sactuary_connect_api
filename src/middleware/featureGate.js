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
 */
export const requireFeature = (featureKey) => {
  return async (req, res, next) => {
    try {
      const { organizationId } = req.user;

      if (!organizationId) {
        return res.status(403).json({
          error: 'No organization found',
          code: 'NO_ORG',
        });
      }

      const org = await Organization.findById(organizationId);
      if (!org) {
        return res.status(403).json({
          error: 'No organization found',
          code: 'NO_ORG',
        });
      }

      const subscription = await Subscription.findOne({ organizationId: org._id });
      if (!subscription) {
        return res.status(403).json({
          error: 'No active subscription',
          code: 'NO_SUB',
        });
      }

      if (subscription.status !== 'active' && subscription.status !== 'trialing') {
        return res.status(403).json({
          error: 'Subscription is not active',
          code: 'SUB_INACTIVE',
          status: subscription.status,
        });
      }

      if (!subscription.hasFeature(featureKey)) {
        return res.status(403).json({
          error: 'Feature not available on your current plan',
          code: 'FEATURE_GATED',
          featureKey,
          currentPlan: subscription.planId,
          requiredPlan: getMinimumPlan(featureKey),
        });
      }

      req.organization = org;
      req.subscription = subscription;
      next();
    } catch (error) {
      console.error('Feature gate error:', error);
      res.status(500).json({ error: 'Failed to verify feature access' });
    }
  };
};

export default { requireFeature };
