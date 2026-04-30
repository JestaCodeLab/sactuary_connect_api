import express from 'express';
import {
  getFinanceOverview,
  getFinanceReport,
  getTransactions,
  getTransactionSummary,
  getTransactionById,
  submitFinanceAccount,
  getFinanceAccountStatus,
} from '../controllers/financeController.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';
import { resolveBranchContext } from '../middleware/branchContext.js';
import { requireFeature, financeAccountApproved } from '../middleware/featureGate.js';

const router = express.Router();

// ===== FINANCE ACCOUNT SETUP (No gate - required for setup) =====
// Check current status of finance account (pending/approved/rejected/not_started)
router.get('/account/status', authenticateToken, resolveBranchContext, getFinanceAccountStatus);

// Submit finance account for approval
router.post('/account/submit', authenticateToken, resolveBranchContext, authorizeRole(['admin']), submitFinanceAccount);

// ===== FINANCE REPORTING & ANALYTICS (Gated by finance account approval) =====
router.get('/overview', authenticateToken, resolveBranchContext, authorizeRole(['admin', 'pastor']), financeAccountApproved(), requireFeature('financial_reporting'), getFinanceOverview);
router.get('/reports', authenticateToken, resolveBranchContext, authorizeRole(['admin', 'pastor']), financeAccountApproved(), requireFeature('advanced_financial_reporting'), getFinanceReport);

// Transaction ledger
router.get('/transactions', authenticateToken, resolveBranchContext, authorizeRole(['admin', 'pastor']), financeAccountApproved(), getTransactions);
router.get('/transactions/summary', authenticateToken, resolveBranchContext, authorizeRole(['admin', 'pastor']), financeAccountApproved(), getTransactionSummary);
router.get('/transactions/:id', authenticateToken, resolveBranchContext, authorizeRole(['admin', 'pastor']), financeAccountApproved(), getTransactionById);

export default router;
