import express from 'express';
import {
  getAllDonations,
  getDonationById,
  createDonation,
  updateDonation,
  getDonationStats
} from '../controllers/donationController.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';

const router = express.Router();

router.get('/', authenticateToken, authorizeRole(['admin', 'pastor']), getAllDonations);
router.get('/:id', authenticateToken, authorizeRole(['admin', 'pastor']), getDonationById);
router.post('/', authenticateToken, createDonation);
router.put('/:id', authenticateToken, authorizeRole(['admin', 'pastor']), updateDonation);
router.get('/stats/summary', authenticateToken, authorizeRole(['admin', 'pastor']), getDonationStats);

export default router;
