import express from 'express';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';
import {
  sendInvite,
  getInvitations,
  revokeInvite,
  getInviteByToken,
  acceptInvite,
} from '../controllers/invitationController.js';

const router = express.Router();

// Admin-only routes
router.post('/', authenticateToken, authorizeRole(['admin']), sendInvite);
router.get('/', authenticateToken, authorizeRole(['admin']), getInvitations);
router.delete('/:id', authenticateToken, authorizeRole(['admin']), revokeInvite);

// Public routes (no auth — anyone with the token link can use these)
router.get('/token/:token', getInviteByToken);
router.post('/token/:token', acceptInvite);

export default router;
