import express from 'express';
import {
  getAllDonations,
  getDonationById,
  createDonation,
  updateDonation,
  getDonationStats
} from '../controllers/donationController.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';
import { resolveBranchContext } from '../middleware/branchContext.js';

const router = express.Router();

router.get('/stats/summary', authenticateToken, resolveBranchContext, authorizeRole(['admin', 'pastor']), getDonationStats);
router.get('/', authenticateToken, resolveBranchContext, authorizeRole(['admin', 'pastor']), getAllDonations);
router.get('/:id', authenticateToken, resolveBranchContext, authorizeRole(['admin', 'pastor']), getDonationById);
router.post('/', authenticateToken, resolveBranchContext, createDonation);
router.put('/:id', authenticateToken, resolveBranchContext, authorizeRole(['admin', 'pastor']), updateDonation);

export default router;
