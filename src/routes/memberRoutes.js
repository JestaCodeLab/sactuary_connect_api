import express from 'express';
import {
  getAllMembers,
  getMemberById,
  createMember,
  updateMember,
  deleteMember,
  getUpcomingBirthdays,
  exportMembers,
  importMembers,
  getImportTemplate,
} from '../controllers/memberController.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';
import { resolveBranchContext } from '../middleware/branchContext.js';
import { requireFeature } from '../middleware/featureGate.js';

const router = express.Router();

router.get('/', authenticateToken, resolveBranchContext, requireFeature('member_directory'), getAllMembers);
router.get('/birthdays/upcoming', authenticateToken, resolveBranchContext, requireFeature('birthday_notifications'), getUpcomingBirthdays);
router.get('/export', authenticateToken, resolveBranchContext, requireFeature('member_directory'), exportMembers);
router.get('/import/template', authenticateToken, requireFeature('member_directory'), getImportTemplate);
router.post('/import', authenticateToken, resolveBranchContext, authorizeRole(['admin', 'pastor']), requireFeature('member_directory'), importMembers);
router.get('/:id', authenticateToken, resolveBranchContext, requireFeature('member_directory'), getMemberById);
router.post('/', authenticateToken, resolveBranchContext, authorizeRole(['admin', 'pastor']), requireFeature('member_directory'), createMember);
router.put('/:id', authenticateToken, resolveBranchContext, authorizeRole(['admin', 'pastor']), requireFeature('member_directory'), updateMember);
router.delete('/:id', authenticateToken, resolveBranchContext, authorizeRole(['admin']), requireFeature('member_directory'), deleteMember);

export default router;
