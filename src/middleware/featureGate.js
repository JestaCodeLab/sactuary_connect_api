import Organization from '../models/Organization.js';
import Subscription from '../models/Subscription.js';
import FinanceAccount from '../models/FinanceAccount.js';
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

/**
 * Middleware to gate finance module access by finance account approval status.
 * Must be used after authenticateToken and branchContext middleware.
 * 
 * Usage: router.get('/path', authenticateToken, resolveBranchContext, financeAccountApproved(), handler)
 */
export const financeAccountApproved = () => {
  return async (req, res, next) => {
    try {
      const organizationId = req.org?._id;
      
      if (!organizationId) {
        return res.status(403).json({ 
          error: 'Organization context required',
          code: 'NO_ORG_CONTEXT'
        });
      }

      // Check if organization has an approved finance account
      const financeAccount = await FinanceAccount.findOne({ 
        organizationId, 
        status: 'approved' 
      }).lean();

      if (!financeAccount) {
        return res.status(403).json({ 
          error: 'Finance account approval required to access this module',
          code: 'FINANCE_ACCOUNT_NOT_APPROVED',
          message: 'Please submit your merchant details for approval before accessing the finance module.'
        });
      }

      // Attach finance account to request for potential use in handlers
      req.financeAccount = financeAccount;
      next();
    } catch (error) {
      console.error('Error in financeAccountApproved middleware:', error);
      res.status(500).json({ error: 'Failed to verify finance account status' });
    }
  };
};

export default { requireFeature, financeAccountApproved };
