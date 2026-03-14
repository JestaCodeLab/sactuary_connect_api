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

      console.log(`[FeatureGate] Checking feature "${featureKey}" for user:`, {
        userId: req.user?.userId,
        organizationId,
      });

      if (!organizationId) {
        console.error('[FeatureGate] No organizationId in req.user');
        return res.status(403).json({
          error: 'No organization found',
          code: 'NO_ORG',
        });
      }

      const org = await Organization.findById(organizationId);
      console.log('[FeatureGate] Organization lookup:', { found: !!org, orgId: org?._id });
      if (!org) {
        return res.status(403).json({
          error: 'No organization found',
          code: 'NO_ORG',
        });
      }

      const subscription = await Subscription.findOne({ organizationId: org._id });
      console.log('[FeatureGate] Subscription lookup:', { 
        found: !!subscription, 
        planId: subscription?.planId,
        status: subscription?.status,
      });
      if (!subscription) {
        console.warn('[FeatureGate] No subscription found - returning NO_SUB error');
        return res.status(403).json({
          error: 'No active subscription',
          code: 'NO_SUB',
          featureKey,
          currentPlan: null,
          requiredPlan: getMinimumPlan(featureKey),
        });
      }

      if (subscription.status !== 'active' && subscription.status !== 'trialing') {
        console.log('[FeatureGate] Subscription inactive:', { status: subscription.status });
        return res.status(403).json({
          error: 'Subscription is not active',
          code: 'SUB_INACTIVE',
          status: subscription.status,
        });
      }

      const hasFeature = subscription.hasFeature(featureKey);
      console.log('[FeatureGate] Feature check result:', { 
        featureKey, 
        hasFeature,
        planId: subscription.planId,
      });

      if (!hasFeature) {
        const planName = PLANS[subscription.planId]?.name || subscription.planId || 'unknown';
        const requiredPlanId = getMinimumPlan(featureKey);
        const requiredPlanName = PLANS[requiredPlanId]?.name || requiredPlanId;
        
        console.log('[FeatureGate] Feature denied:', {
          currentPlanId: subscription.planId,
          currentPlanName: planName,
          requiredPlanId,
          requiredPlanName,
        });
        
        return res.status(403).json({
          error: 'Feature not available on your current plan',
          code: 'FEATURE_GATED',
          featureKey,
          currentPlan: planName,
          requiredPlan: requiredPlanName,
        });
      }

      console.log('[FeatureGate] Feature allowed - proceeding to next middleware/handler');
      req.organization = org;
      req.subscription = subscription;
      next();
    } catch (error) {
      console.error('Feature gate error:', {
        featureKey,
        message: error.message,
        stack: error.stack,
      });
      res.status(500).json({
        error: 'Failed to verify feature access',
        details: error.message,
      });
    }
  };
};

export default { requireFeature };
