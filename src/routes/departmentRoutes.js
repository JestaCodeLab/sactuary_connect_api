import express from 'express';
import {
  getAllDepartments,
  getDepartmentById,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  addMemberToDepartment,
  removeMemberFromDepartment,
} from '../controllers/departmentController.js';
import { getDepartmentInsights } from '../controllers/departmentInsightsController.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';
import { resolveBranchContext } from '../middleware/branchContext.js';
import { requireFeature } from '../middleware/featureGate.js';

const router = express.Router();

router.get('/', authenticateToken, resolveBranchContext, requireFeature('department_management'), getAllDepartments);
router.get('/:id', authenticateToken, resolveBranchContext, requireFeature('department_management'), getDepartmentById);
router.get('/:id/insights', authenticateToken, resolveBranchContext, requireFeature('department_management'), getDepartmentInsights);
router.post('/', authenticateToken, resolveBranchContext, authorizeRole(['admin', 'pastor']), requireFeature('department_management'), createDepartment);
router.put('/:id', authenticateToken, resolveBranchContext, authorizeRole(['admin', 'pastor']), requireFeature('department_management'), updateDepartment);
router.delete('/:id', authenticateToken, resolveBranchContext, authorizeRole(['admin']), requireFeature('department_management'), deleteDepartment);
router.post('/:id/members', authenticateToken, resolveBranchContext, authorizeRole(['admin', 'pastor']), requireFeature('department_management'), addMemberToDepartment);
router.delete('/:id/members/:memberId', authenticateToken, resolveBranchContext, authorizeRole(['admin', 'pastor']), requireFeature('department_management'), removeMemberFromDepartment);

export default router;
