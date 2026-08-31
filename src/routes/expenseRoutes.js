import express from 'express';
import {
  getAllExpenses,
  getExpenseById,
  createExpense,
  approveExpense,
  rejectExpense,
  updateExpense,
  deleteExpense,
  getExpenseStats,
} from '../controllers/expenseController.js';
import { authenticateToken, authorizeRoleOrPermission } from '../middleware/auth.js';
import { resolveBranchContext } from '../middleware/branchContext.js';
import { requireFeature, financeAccountApproved } from '../middleware/featureGate.js';

const router = express.Router();

router.get('/stats/summary', authenticateToken, resolveBranchContext, authorizeRoleOrPermission(['admin', 'pastor'], 'finance.view'), financeAccountApproved(), requireFeature('financial_reporting'), getExpenseStats);
router.get('/', authenticateToken, resolveBranchContext, authorizeRoleOrPermission(['admin', 'pastor'], 'finance.view'), financeAccountApproved(), requireFeature('financial_reporting'), getAllExpenses);
router.get('/:id', authenticateToken, resolveBranchContext, authorizeRoleOrPermission(['admin', 'pastor'], 'finance.view'), financeAccountApproved(), requireFeature('financial_reporting'), getExpenseById);
router.post('/', authenticateToken, resolveBranchContext, authorizeRoleOrPermission(['admin', 'pastor'], 'finance.manage'), financeAccountApproved(), requireFeature('financial_reporting'), createExpense);
router.put('/:id', authenticateToken, resolveBranchContext, authorizeRoleOrPermission(['admin', 'pastor'], 'finance.manage'), financeAccountApproved(), requireFeature('financial_reporting'), updateExpense);
router.post('/:id/approve', authenticateToken, resolveBranchContext, authorizeRoleOrPermission(['admin'], 'finance.manage'), financeAccountApproved(), requireFeature('financial_reporting'), approveExpense);
router.post('/:id/reject', authenticateToken, resolveBranchContext, authorizeRoleOrPermission(['admin'], 'finance.manage'), financeAccountApproved(), requireFeature('financial_reporting'), rejectExpense);
router.delete('/:id', authenticateToken, resolveBranchContext, authorizeRoleOrPermission(['admin'], 'finance.manage'), financeAccountApproved(), requireFeature('financial_reporting'), deleteExpense);

export default router;
