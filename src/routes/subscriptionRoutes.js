import express from 'express';
import {
  getPlans,
  getPlan,
  createSubscription,
  getSubscription,
  updateSubscription,
  cancelSubscription,
  reactivateSubscription,
  checkFeature,
  checkLimits,
  updateUsage,
  initializeUpgrade,
  verifyUpgrade,
  getMySubscriptionDebug,
} from '../controllers/subscriptionController.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';
import { resolveBranchContext } from '../middleware/branchContext.js';

const router = express.Router();

// Public routes - no auth required
router.get('/plans', getPlans);
router.get('/plans/:planId', getPlan);

// Protected routes - require authentication
router.post('/', authenticateToken, authorizeRole(['admin']), createSubscription);
router.get('/debug/me', authenticateToken, getMySubscriptionDebug);
router.get('/:organizationId', authenticateToken, getSubscription);
router.put('/:organizationId', authenticateToken, authorizeRole(['admin']), updateSubscription);

// Payment endpoints
router.post('/:organizationId/initialize-payment', authenticateToken, authorizeRole(['admin']), initializeUpgrade);
router.post('/:organizationId/verify-payment', authenticateToken, authorizeRole(['admin']), verifyUpgrade);

// Subscription management
router.post('/:organizationId/cancel', authenticateToken, authorizeRole(['admin']), cancelSubscription);
router.post('/:organizationId/reactivate', authenticateToken, authorizeRole(['admin']), reactivateSubscription);

// Feature and limit checking
router.get('/:organizationId/features/:featureKey', authenticateToken, checkFeature);
router.get('/:organizationId/limits', authenticateToken, resolveBranchContext, checkLimits);
router.put('/:organizationId/usage', authenticateToken, updateUsage);

export default router;
