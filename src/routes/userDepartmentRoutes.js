import express from 'express';
import {
  getMyDepartments,
  assignDepartments,
  removeDepartment,
} from '../controllers/userDepartmentController.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';

const router = express.Router();

router.get('/users/me/departments', authenticateToken, getMyDepartments);
router.post('/organizations/:orgId/users/:userId/departments', authenticateToken, authorizeRole(['admin']), assignDepartments);
router.delete('/organizations/:orgId/users/:userId/departments/:departmentId', authenticateToken, authorizeRole(['admin']), removeDepartment);

export default router;
