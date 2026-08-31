import express from 'express';
import {
  getAllDonations,
  getDonationById,
  createDonation,
  updateDonation,
  getDonationStats,
  sendReceipt
} from '../controllers/donationController.js';
import { authenticateToken, authorizeRoleOrPermission } from '../middleware/auth.js';
import { resolveBranchContext } from '../middleware/branchContext.js';
import { requireFeature, financeAccountApproved } from '../middleware/featureGate.js';

const router = express.Router();

router.get('/stats/summary', authenticateToken, resolveBranchContext, authorizeRoleOrPermission(['admin', 'pastor'], 'donations.view'), financeAccountApproved(), requireFeature('online_giving'), getDonationStats);
router.get('/', authenticateToken, resolveBranchContext, authorizeRoleOrPermission(['admin', 'pastor'], 'donations.view'), financeAccountApproved(), requireFeature('online_giving'), getAllDonations);
router.get('/:id', authenticateToken, resolveBranchContext, authorizeRoleOrPermission(['admin', 'pastor'], 'donations.view'), financeAccountApproved(), requireFeature('online_giving'), getDonationById);
router.post('/', authenticateToken, resolveBranchContext, financeAccountApproved(), requireFeature('online_giving'), createDonation);
router.put('/:id', authenticateToken, resolveBranchContext, authorizeRoleOrPermission(['admin', 'pastor'], 'donations.manage'), financeAccountApproved(), requireFeature('online_giving'), updateDonation);
router.post('/:id/receipt', authenticateToken, resolveBranchContext, authorizeRoleOrPermission(['admin', 'pastor'], 'donations.manage'), financeAccountApproved(), requireFeature('online_giving'), sendReceipt);

export default router;
