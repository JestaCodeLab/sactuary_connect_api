import express from 'express';
import multer from 'multer';
import {
  getFinanceOverview,
  getFinanceReport,
  getFinanceReportPdf,
  getTransactions,
  getTransactionSummary,
  getTransactionById,
  submitFinanceAccount,
  getFinanceAccountStatus,
  getBankList,
  getBranchAccounts,
  createBranchSubaccount,
  getOfferingTypes,
  createOfferingType,
  updateOfferingType,
  deleteOfferingType,
  getExpenseCategories,
  createExpenseCategory,
  updateExpenseCategory,
  deleteExpenseCategory,
  getProjects,
  createProject,
  updateProject,
  getProjectGroups,
  createProjectGroup,
  updateProjectGroup,
  deleteProjectGroup,
} from '../controllers/financeController.js';
import { authenticateToken, authorizeRole, authorizeRoleOrPermission } from '../middleware/auth.js';
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
// Check current status of finance account (pending/approved/rejected/not_started/no_branch_account)
router.get('/account/status', authenticateToken, resolveBranchContext, getFinanceAccountStatus);

// Submit finance account for approval (with file uploads) — creates the org's primary account
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

// ===== BRANCH FINANCE ACCOUNTS (Finance Settings — admin, org-wide) =====
router.get('/branch-accounts', authenticateToken, resolveBranchContext, authorizeRole(['admin']), getBranchAccounts);
router.post('/branch-accounts/:branchId/subaccount', authenticateToken, resolveBranchContext, authorizeRole(['admin']), createBranchSubaccount);

// ===== FINANCE REPORTING & ANALYTICS (Gated by branch finance account approval) =====
router.get('/overview', authenticateToken, resolveBranchContext, authorizeRoleOrPermission(['admin', 'pastor'], 'finance.view'), financeAccountApproved(), requireFeature('financial_reporting'), getFinanceOverview);
router.get('/reports', authenticateToken, resolveBranchContext, authorizeRoleOrPermission(['admin', 'pastor'], 'finance.view'), financeAccountApproved(), requireFeature('advanced_financial_reporting'), getFinanceReport);
router.get('/reports/pdf', authenticateToken, resolveBranchContext, authorizeRoleOrPermission(['admin', 'pastor'], 'finance.view'), financeAccountApproved(), requireFeature('advanced_financial_reporting'), getFinanceReportPdf);

// Transaction ledger — NOT gated by finance account approval: it includes
// subscription_payment/sms_credit_purchase records unrelated to a branch's
// Paystack KYC status, so it must stay visible even before KYC is done.
router.get('/transactions', authenticateToken, resolveBranchContext, authorizeRoleOrPermission(['admin', 'pastor'], 'finance.view'), getTransactions);
router.get('/transactions/summary', authenticateToken, resolveBranchContext, authorizeRoleOrPermission(['admin', 'pastor'], 'finance.view'), getTransactionSummary);
router.get('/transactions/:id', authenticateToken, resolveBranchContext, authorizeRoleOrPermission(['admin', 'pastor'], 'finance.view'), getTransactionById);

// Offering types (dynamic, branch-scoped, merchant-defined)
router.get('/offering-types', authenticateToken, resolveBranchContext, financeAccountApproved(), getOfferingTypes);
router.post('/offering-types', authenticateToken, resolveBranchContext, authorizeRoleOrPermission(['admin', 'pastor'], 'finance.manage'), financeAccountApproved(), createOfferingType);
router.put('/offering-types/:id', authenticateToken, resolveBranchContext, authorizeRoleOrPermission(['admin', 'pastor'], 'finance.manage'), financeAccountApproved(), updateOfferingType);
router.delete('/offering-types/:id', authenticateToken, resolveBranchContext, authorizeRoleOrPermission(['admin', 'pastor'], 'finance.manage'), financeAccountApproved(), deleteOfferingType);

// Expense categories (dynamic, branch-scoped, merchant-defined)
router.get('/expense-categories', authenticateToken, resolveBranchContext, financeAccountApproved(), getExpenseCategories);
router.post('/expense-categories', authenticateToken, resolveBranchContext, authorizeRoleOrPermission(['admin', 'pastor'], 'finance.manage'), financeAccountApproved(), createExpenseCategory);
router.put('/expense-categories/:id', authenticateToken, resolveBranchContext, authorizeRoleOrPermission(['admin', 'pastor'], 'finance.manage'), financeAccountApproved(), updateExpenseCategory);
router.delete('/expense-categories/:id', authenticateToken, resolveBranchContext, authorizeRoleOrPermission(['admin', 'pastor'], 'finance.manage'), financeAccountApproved(), deleteExpenseCategory);

// Projects (mission/building/other funds with a fundraising goal)
router.get('/projects', authenticateToken, resolveBranchContext, financeAccountApproved(), getProjects);
router.post('/projects', authenticateToken, resolveBranchContext, authorizeRoleOrPermission(['admin', 'pastor'], 'finance.manage'), financeAccountApproved(), createProject);
router.put('/projects/:id', authenticateToken, resolveBranchContext, authorizeRoleOrPermission(['admin', 'pastor'], 'finance.manage'), financeAccountApproved(), updateProject);

// Project groups (dynamic, branch-scoped, merchant-defined categories for projects)
router.get('/project-groups', authenticateToken, resolveBranchContext, financeAccountApproved(), getProjectGroups);
router.post('/project-groups', authenticateToken, resolveBranchContext, authorizeRoleOrPermission(['admin', 'pastor'], 'finance.manage'), financeAccountApproved(), createProjectGroup);
router.put('/project-groups/:id', authenticateToken, resolveBranchContext, authorizeRoleOrPermission(['admin', 'pastor'], 'finance.manage'), financeAccountApproved(), updateProjectGroup);
router.delete('/project-groups/:id', authenticateToken, resolveBranchContext, authorizeRoleOrPermission(['admin', 'pastor'], 'finance.manage'), financeAccountApproved(), deleteProjectGroup);

export default router;
