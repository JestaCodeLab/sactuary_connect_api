import express from 'express';
import {
  getPlans,
  getPlan,
  createSubscription,
  initializeCheckout,
  getSubscription,
  updateSubscription,
  cancelSubscription,
  reactivateSubscription,
  renewSubscription,
  checkFeature,
  checkLimits,
  updateUsage,
  initializeUpgrade,
  verifyUpgrade,
  getMySubscriptionDebug,
} from '../controllers/subscriptionController.js';
import { authenticateToken, authorizeRole, verifyOrgOwnership } from '../middleware/auth.js';
import { resolveBranchContext } from '../middleware/branchContext.js';

const router = express.Router();

// Public routes - no auth required
router.get('/plans', getPlans);
router.get('/plans/:planId', getPlan);

// Protected routes - require authentication
router.post('/', authenticateToken, authorizeRole(['admin']), verifyOrgOwnership, createSubscription);
router.post('/initialize-checkout', authenticateToken, authorizeRole(['admin']), initializeCheckout);
router.get('/debug/me', authenticateToken, getMySubscriptionDebug);
router.get('/:organizationId', authenticateToken, verifyOrgOwnership, getSubscription);
router.put('/:organizationId', authenticateToken, authorizeRole(['admin']), verifyOrgOwnership, updateSubscription);

// Payment endpoints
router.post('/:organizationId/initialize-payment', authenticateToken, authorizeRole(['admin']), verifyOrgOwnership, initializeUpgrade);
router.post('/:organizationId/verify-payment', authenticateToken, authorizeRole(['admin']), verifyOrgOwnership, verifyUpgrade);

// Subscription management
router.post('/:organizationId/cancel', authenticateToken, authorizeRole(['admin']), verifyOrgOwnership, cancelSubscription);
router.post('/:organizationId/reactivate', authenticateToken, authorizeRole(['admin']), verifyOrgOwnership, reactivateSubscription);
router.post('/:organizationId/renew', authenticateToken, authorizeRole(['admin']), verifyOrgOwnership, renewSubscription);

// Feature and limit checking
router.get('/:organizationId/features/:featureKey', authenticateToken, verifyOrgOwnership, checkFeature);
router.get('/:organizationId/limits', authenticateToken, verifyOrgOwnership, resolveBranchContext, checkLimits);
router.put('/:organizationId/usage', authenticateToken, authorizeRole(['admin']), verifyOrgOwnership, updateUsage);

export default router;
