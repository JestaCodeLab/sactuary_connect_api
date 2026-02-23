import express from 'express';
import {
  getAllExpenses,
  getExpenseById,
  createExpense,
  updateExpense,
  deleteExpense,
  getExpenseStats,
} from '../controllers/expenseController.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';
import { resolveBranchContext } from '../middleware/branchContext.js';

const router = express.Router();

router.get('/stats/summary', authenticateToken, resolveBranchContext, authorizeRole(['admin', 'pastor']), getExpenseStats);
router.get('/', authenticateToken, resolveBranchContext, authorizeRole(['admin', 'pastor']), getAllExpenses);
router.get('/:id', authenticateToken, resolveBranchContext, authorizeRole(['admin', 'pastor']), getExpenseById);
router.post('/', authenticateToken, resolveBranchContext, authorizeRole(['admin', 'pastor']), createExpense);
router.put('/:id', authenticateToken, resolveBranchContext, authorizeRole(['admin', 'pastor']), updateExpense);
router.delete('/:id', authenticateToken, resolveBranchContext, authorizeRole(['admin']), deleteExpense);

export default router;
