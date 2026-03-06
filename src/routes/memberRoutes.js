import express from 'express';
import {
  getAllMembers,
  getMemberById,
  createMember,
  updateMember,
  deleteMember,
  getUpcomingBirthdays,
} from '../controllers/memberController.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';
import { resolveBranchContext } from '../middleware/branchContext.js';
import { requireFeature } from '../middleware/featureGate.js';

const router = express.Router();

router.get('/', authenticateToken, resolveBranchContext, getAllMembers);
router.get('/birthdays/upcoming', authenticateToken, resolveBranchContext, getUpcomingBirthdays);
router.get('/:id', authenticateToken, resolveBranchContext, getMemberById);
router.post('/', authenticateToken, resolveBranchContext, authorizeRole(['admin', 'pastor']), createMember);
router.put('/:id', authenticateToken, resolveBranchContext, authorizeRole(['admin', 'pastor']), updateMember);
router.delete('/:id', authenticateToken, resolveBranchContext, authorizeRole(['admin']), deleteMember);

export default router;
