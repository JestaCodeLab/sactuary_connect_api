import express from 'express';
import multer from 'multer';
import {
  getFinanceOverview,
  getFinanceReport,
  getTransactions,
  getTransactionSummary,
  getTransactionById,
  submitFinanceAccount,
  getFinanceAccountStatus,
  getBankList,
} from '../controllers/financeController.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';
import { resolveBranchContext } from '../middleware/branchContext.js';
import { requireFeature, financeAccountApproved } from '../middleware/featureGate.js';

const router = express.Router();

// Multer config for KYC document uploads (memory storage, max 5MB per file)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, JPEG, PNG, and WebP are allowed.'));
    }
  },
});

// ===== FINANCE ACCOUNT SETUP (No gate - required for setup) =====
// Check current status of finance account (pending/approved/rejected/not_started)
router.get('/account/status', authenticateToken, resolveBranchContext, getFinanceAccountStatus);

// Submit finance account for approval (with file uploads)
router.post(
  '/account/submit',
  authenticateToken,
  resolveBranchContext,
  authorizeRole(['admin']),
  upload.fields([
    { name: 'businessRegistrationDoc', maxCount: 1 },
    { name: 'ownerIdDoc', maxCount: 1 },
  ]),
  submitFinanceAccount
);

// Get list of Ghanaian banks for dropdown (no auth required - used during KYC form setup)
router.get('/banks', getBankList);

// ===== FINANCE REPORTING & ANALYTICS (Gated by finance account approval) =====
router.get('/overview', authenticateToken, resolveBranchContext, authorizeRole(['admin', 'pastor']), financeAccountApproved(), requireFeature('financial_reporting'), getFinanceOverview);
router.get('/reports', authenticateToken, resolveBranchContext, authorizeRole(['admin', 'pastor']), financeAccountApproved(), requireFeature('advanced_financial_reporting'), getFinanceReport);

// Transaction ledger
router.get('/transactions', authenticateToken, resolveBranchContext, authorizeRole(['admin', 'pastor']), getTransactions);
router.get('/transactions/summary', authenticateToken, resolveBranchContext, authorizeRole(['admin', 'pastor']), getTransactionSummary);
router.get('/transactions/:id', authenticateToken, resolveBranchContext, authorizeRole(['admin', 'pastor']), getTransactionById);

export default router;
