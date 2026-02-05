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
} from '../controllers/subscriptionController.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';

const router = express.Router();

// Public routes - no auth required
router.get('/plans', getPlans);
router.get('/plans/:planId', getPlan);

// Protected routes - require authentication
router.post('/', authenticateToken, authorizeRole(['admin']), createSubscription);
router.get('/:organizationId', authenticateToken, getSubscription);
router.put('/:organizationId', authenticateToken, authorizeRole(['admin']), updateSubscription);

// Subscription management
router.post('/:organizationId/cancel', authenticateToken, authorizeRole(['admin']), cancelSubscription);
router.post('/:organizationId/reactivate', authenticateToken, authorizeRole(['admin']), reactivateSubscription);

// Feature and limit checking
router.get('/:organizationId/features/:featureKey', authenticateToken, checkFeature);
router.get('/:organizationId/limits', authenticateToken, checkLimits);
router.put('/:organizationId/usage', authenticateToken, updateUsage);

export default router;
