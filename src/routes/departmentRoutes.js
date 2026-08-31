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
import { authenticateToken, authorizeRoleOrPermission } from '../middleware/auth.js';
import { resolveBranchContext } from '../middleware/branchContext.js';
import { resolveDepartmentContext } from '../middleware/departmentContext.js';
import { requireFeature } from '../middleware/featureGate.js';

const router = express.Router();

router.get('/', authenticateToken, resolveBranchContext, resolveDepartmentContext, requireFeature('department_management'), getAllDepartments);
router.get('/:id', authenticateToken, resolveBranchContext, resolveDepartmentContext, requireFeature('department_management'), getDepartmentById);
router.get('/:id/insights', authenticateToken, resolveBranchContext, resolveDepartmentContext, requireFeature('department_management'), getDepartmentInsights);
router.post('/', authenticateToken, resolveBranchContext, authorizeRoleOrPermission(['admin', 'pastor'], 'departments.manage'), requireFeature('department_management'), createDepartment);
router.put('/:id', authenticateToken, resolveBranchContext, resolveDepartmentContext, authorizeRoleOrPermission(['admin', 'pastor'], 'departments.manage'), requireFeature('department_management'), updateDepartment);
router.delete('/:id', authenticateToken, resolveBranchContext, resolveDepartmentContext, authorizeRoleOrPermission(['admin'], 'departments.manage'), requireFeature('department_management'), deleteDepartment);
router.post('/:id/members', authenticateToken, resolveBranchContext, resolveDepartmentContext, authorizeRoleOrPermission(['admin', 'pastor'], 'departments.manage'), requireFeature('department_management'), addMemberToDepartment);
router.delete('/:id/members/:memberId', authenticateToken, resolveBranchContext, resolveDepartmentContext, authorizeRoleOrPermission(['admin', 'pastor'], 'departments.manage'), requireFeature('department_management'), removeMemberFromDepartment);

export default router;
