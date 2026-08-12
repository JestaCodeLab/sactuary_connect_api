import express from 'express';
import {
  createOrganization,
  getOrganization,
  getMyOrganization,
  updateOrganization,
  createBranch,
  getBranches,
  updateBranch,
  createFundBucket,
  getFundBuckets,
} from '../controllers/organizationController.js';
import { authenticateToken, authorizeRole, verifyOrgOwnership } from '../middleware/auth.js';

const router = express.Router();

// Organization routes
// Allow any authenticated user to create their first organization (onboarding flow)
// The controller will promote them to admin after creation
router.post('/', authenticateToken, createOrganization);
router.get('/me', authenticateToken, getMyOrganization); // Must be before /:id to avoid conflict
router.get('/:id', authenticateToken, getOrganization);
router.put('/:id', authenticateToken, authorizeRole(['admin']), updateOrganization);

// Branch routes
router.post('/:organizationId/branches', authenticateToken, authorizeRole(['admin']), verifyOrgOwnership, createBranch);
router.get('/:organizationId/branches', authenticateToken, verifyOrgOwnership, getBranches);
router.put('/:organizationId/branches/:branchId', authenticateToken, authorizeRole(['admin']), verifyOrgOwnership, updateBranch);

// Fund bucket routes
router.post('/:organizationId/fund-buckets', authenticateToken, authorizeRole(['admin']), createFundBucket);
router.get('/:organizationId/fund-buckets', authenticateToken, getFundBuckets);

export default router;
