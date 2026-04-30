import { Router } from 'express';
import { authenticateToken, requireSuperadmin } from '../middleware/auth.js';
import {
  getStats,
  listOrganizations,
  getOrganization,
  createOrganization,
  updateOrganization,
  updateOrgStatus,
  deleteOrganization,
  listSubscriptions,
  createSubscription,
  updateSubscription,
  deleteSubscription,
  listBranches,
  getBranch,
  createBranch,
  updateBranch,
  deleteBranch,
  listDepartments,
  getDepartment,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  listMembers,
  getMember,
  updateMember,
  deleteMember,
  listSmsCredits,
  adjustSmsCredits,
  listSmsPackages,
  createSmsPackage,
  updateSmsPackage,
  deleteSmsPackage,
  getAuditLog,
  createSuperadmin,
  listPendingFinanceAccounts,
  getFinanceAccountDetails,
  approveFinanceAccount,
  rejectFinanceAccount,
  revokeFinanceAccount,
} from '../controllers/superadminController.js';

const router = Router();

// All superadmin routes require a valid JWT with role === 'superadmin'
router.use(authenticateToken, requireSuperadmin);

// Platform stats
router.get('/stats', getStats);

// Organizations
router.get('/organizations', listOrganizations);
router.post('/organizations', createOrganization);
router.get('/organizations/:id', getOrganization);
router.patch('/organizations/:id', updateOrganization);
router.patch('/organizations/:id/status', updateOrgStatus);
router.delete('/organizations/:id', deleteOrganization);

// Branches
router.get('/branches', listBranches);
router.post('/branches', createBranch);
router.get('/branches/:id', getBranch);
router.patch('/branches/:id', updateBranch);
router.delete('/branches/:id', deleteBranch);

// Departments
router.get('/departments', listDepartments);
router.post('/departments', createDepartment);
router.get('/departments/:id', getDepartment);
router.patch('/departments/:id', updateDepartment);
router.delete('/departments/:id', deleteDepartment);

// Members
router.get('/members', listMembers);
router.get('/members/:id', getMember);
router.patch('/members/:id', updateMember);
router.delete('/members/:id', deleteMember);

// Subscriptions
router.get('/subscriptions', listSubscriptions);
router.post('/subscriptions', createSubscription);
router.patch('/subscriptions/:orgId', updateSubscription);
router.delete('/subscriptions/:id', deleteSubscription);

// SMS Packages
router.get('/sms-packages', listSmsPackages);
router.post('/sms-packages', createSmsPackage);
router.patch('/sms-packages/:id', updateSmsPackage);
router.delete('/sms-packages/:id', deleteSmsPackage);

// SMS Credits
router.get('/sms-credits', listSmsCredits);
router.patch('/sms-credits/:orgId', adjustSmsCredits);

// Audit log
router.get('/audit-log', getAuditLog);

// Create new superadmin (only existing superadmin can do this)
router.post('/create-admin', createSuperadmin);

// ===== FINANCE ACCOUNT APPROVALS =====
router.get('/finance-accounts', listPendingFinanceAccounts);
router.get('/finance-accounts/:id', getFinanceAccountDetails);
router.post('/finance-accounts/:id/approve', approveFinanceAccount);
router.post('/finance-accounts/:id/reject', rejectFinanceAccount);
router.post('/finance-accounts/:id/revoke', revokeFinanceAccount);

export default router;
