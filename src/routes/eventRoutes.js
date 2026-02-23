import express from 'express';
import {
  getAllEvents,
  getEventById,
  createEvent,
  updateEvent,
  deleteEvent,
  registerForEvent,
  generateShareLink,
  getPublicEvent,
  shareEventByEmail,
} from '../controllers/eventController.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';
import { resolveBranchContext } from '../middleware/branchContext.js';
import { requireFeature } from '../middleware/featureGate.js';

const router = express.Router();

// Public route (no auth required)
router.get('/public/:shareToken', getPublicEvent);

// Authenticated routes
router.get('/', authenticateToken, resolveBranchContext, getAllEvents);
router.get('/:id', authenticateToken, resolveBranchContext, getEventById);
router.post('/', authenticateToken, resolveBranchContext, authorizeRole(['admin', 'pastor']), createEvent);
router.put('/:id', authenticateToken, resolveBranchContext, authorizeRole(['admin', 'pastor']), updateEvent);
router.delete('/:id', authenticateToken, resolveBranchContext, authorizeRole(['admin']), deleteEvent);
router.post('/:eventId/register', authenticateToken, resolveBranchContext, registerForEvent);

// Sharing routes (feature-gated)
router.post('/:id/share', authenticateToken, resolveBranchContext, requireFeature('event_sharing'), generateShareLink);
router.post('/:id/share/email', authenticateToken, resolveBranchContext, requireFeature('event_sharing'), shareEventByEmail);

export default router;
