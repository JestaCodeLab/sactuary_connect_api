import express from 'express';
import {
  getMyBranches,
  getOrgUsers,
  assignBranches,
  removeBranch,
} from '../controllers/userBranchController.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';

const router = express.Router();

// Current user's branches
router.get('/users/me/branches', authenticateToken, getMyBranches);

// Org user management (admin only, except listing which pastors also need for department leader selection)
router.get('/organizations/:orgId/users', authenticateToken, authorizeRole(['admin', 'pastor']), getOrgUsers);
router.post('/organizations/:orgId/users/:userId/branches', authenticateToken, authorizeRole(['admin']), assignBranches);
router.delete('/organizations/:orgId/users/:userId/branches/:branchId', authenticateToken, authorizeRole(['admin']), removeBranch);

export default router;
