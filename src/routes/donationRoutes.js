import express from 'express';
import {
  getAllDonations,
  getDonationById,
  createDonation,
  updateDonation,
  getDonationStats,
  sendReceipt
} from '../controllers/donationController.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';
import { resolveBranchContext } from '../middleware/branchContext.js';
import { requireFeature, financeAccountApproved } from '../middleware/featureGate.js';

const router = express.Router();

router.get('/stats/summary', authenticateToken, resolveBranchContext, authorizeRole(['admin', 'pastor']), financeAccountApproved(), requireFeature('online_giving'), getDonationStats);
router.get('/', authenticateToken, resolveBranchContext, authorizeRole(['admin', 'pastor']), financeAccountApproved(), requireFeature('online_giving'), getAllDonations);
router.get('/:id', authenticateToken, resolveBranchContext, authorizeRole(['admin', 'pastor']), financeAccountApproved(), requireFeature('online_giving'), getDonationById);
router.post('/', authenticateToken, resolveBranchContext, financeAccountApproved(), requireFeature('online_giving'), createDonation);
router.put('/:id', authenticateToken, resolveBranchContext, authorizeRole(['admin', 'pastor']), financeAccountApproved(), requireFeature('online_giving'), updateDonation);
router.post('/:id/receipt', authenticateToken, resolveBranchContext, authorizeRole(['admin', 'pastor']), financeAccountApproved(), requireFeature('online_giving'), sendReceipt);

export default router;
