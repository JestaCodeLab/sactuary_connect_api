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
 * Middleware to gate finance module access by branch-scoped finance account
 * approval status. Must be used after authenticateToken and branchContext
 * middleware. A specific branch must be selected (no "All Branches"), and that
 * branch must have its own approved FinanceAccount — either the org's primary
 * (full KYC) account or a self-service subaccount. Tier-agnostic: both are
 * gated identically since subaccounts are created already-approved.
 *
 * Usage: router.get('/path', authenticateToken, resolveBranchContext, financeAccountApproved(), handler)
 */
export const financeAccountApproved = () => {
  return async (req, res, next) => {
    try {
      const organizationId = req.organizationId;

      if (!organizationId) {
        return res.status(403).json({
          error: 'Organization context required',
          code: 'NO_ORG_CONTEXT'
        });
      }

      if (!req.branchId) {
        return res.status(403).json({
          error: 'Select a specific branch to access the finance module',
          code: 'NO_BRANCH_SELECTED'
        });
      }

      // Check if this specific branch has an approved finance account
      const financeAccount = await FinanceAccount.findOne({
        organizationId,
        branchId: req.branchId,
        status: 'approved'
      }).lean();

      if (!financeAccount) {
        return res.status(403).json({
          error: 'This branch does not have an approved finance account',
          code: 'FINANCE_ACCOUNT_NOT_APPROVED',
          message: 'Set up a finance account for this branch before accessing the finance module.'
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
