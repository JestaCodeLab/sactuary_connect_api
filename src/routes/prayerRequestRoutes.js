import express from 'express';
import {
  getAllPrayerRequests,
  getPrayerRequestById,
  createPrayerRequest,
  prayForRequest,
  markAsAnswered,
  deletePrayerRequest,
} from '../controllers/prayerRequestController.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';
import { resolveBranchContext } from '../middleware/branchContext.js';

const router = express.Router();

router.get('/', authenticateToken, resolveBranchContext, getAllPrayerRequests);
router.get('/:id', authenticateToken, resolveBranchContext, getPrayerRequestById);
router.post('/', authenticateToken, resolveBranchContext, createPrayerRequest);
router.post('/:id/pray', authenticateToken, resolveBranchContext, prayForRequest);
router.patch('/:id/answered', authenticateToken, resolveBranchContext, markAsAnswered);
router.delete('/:id', authenticateToken, resolveBranchContext, authorizeRole(['admin', 'pastor']), deletePrayerRequest);

export default router;
