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

const router = express.Router();

router.get('/', authenticateToken, getAllPrayerRequests);
router.get('/:id', authenticateToken, getPrayerRequestById);
router.post('/', authenticateToken, createPrayerRequest);
router.post('/:id/pray', authenticateToken, prayForRequest);
router.patch('/:id/answered', authenticateToken, markAsAnswered);
router.delete('/:id', authenticateToken, authorizeRole(['admin', 'pastor']), deletePrayerRequest);

export default router;
