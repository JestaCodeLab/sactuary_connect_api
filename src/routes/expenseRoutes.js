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
import { authenticateToken, authorizeRole } from '../middleware/auth.js';
import { resolveBranchContext } from '../middleware/branchContext.js';
import { requireFeature, financeAccountApproved } from '../middleware/featureGate.js';

const router = express.Router();

router.get('/stats/summary', authenticateToken, resolveBranchContext, authorizeRole(['admin', 'pastor']), financeAccountApproved(), requireFeature('financial_reporting'), getExpenseStats);
router.get('/', authenticateToken, resolveBranchContext, authorizeRole(['admin', 'pastor']), financeAccountApproved(), requireFeature('financial_reporting'), getAllExpenses);
router.get('/:id', authenticateToken, resolveBranchContext, authorizeRole(['admin', 'pastor']), financeAccountApproved(), requireFeature('financial_reporting'), getExpenseById);
router.post('/', authenticateToken, resolveBranchContext, authorizeRole(['admin', 'pastor']), financeAccountApproved(), requireFeature('financial_reporting'), createExpense);
router.put('/:id', authenticateToken, resolveBranchContext, authorizeRole(['admin', 'pastor']), financeAccountApproved(), requireFeature('financial_reporting'), updateExpense);
router.post('/:id/approve', authenticateToken, resolveBranchContext, authorizeRole(['admin']), financeAccountApproved(), requireFeature('financial_reporting'), approveExpense);
router.post('/:id/reject', authenticateToken, resolveBranchContext, authorizeRole(['admin']), financeAccountApproved(), requireFeature('financial_reporting'), rejectExpense);
router.delete('/:id', authenticateToken, resolveBranchContext, authorizeRole(['admin']), financeAccountApproved(), requireFeature('financial_reporting'), deleteExpense);

export default router;
