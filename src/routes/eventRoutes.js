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
  getUpcomingOccurrences,
  generateQRCode,
  getQRCode,
  getEventByToken,
  searchMembersForCheckIn,
  getServiceCode,
  regenerateServiceCode,
} from '../controllers/eventController.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';
import { resolveBranchContext } from '../middleware/branchContext.js';
import { requireFeature } from '../middleware/featureGate.js';
import { publicCheckInLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

// Public routes (no auth required)
router.get('/public/:shareToken', publicCheckInLimiter, getPublicEvent);
router.get('/check-in/:token', publicCheckInLimiter, getEventByToken);
router.get('/check-in/:token/members', publicCheckInLimiter, searchMembersForCheckIn);

// Authenticated routes
router.get('/', authenticateToken, resolveBranchContext, requireFeature('event_management'), getAllEvents);
router.get('/:id', authenticateToken, resolveBranchContext, requireFeature('event_management'), getEventById);
router.post('/', authenticateToken, resolveBranchContext, authorizeRole(['admin', 'pastor']), requireFeature('event_management'), createEvent);
router.put('/:id', authenticateToken, resolveBranchContext, authorizeRole(['admin', 'pastor']), requireFeature('event_management'), updateEvent);
router.delete('/:id', authenticateToken, resolveBranchContext, authorizeRole(['admin']), requireFeature('event_management'), deleteEvent);
router.get('/:id/occurrences', authenticateToken, resolveBranchContext, requireFeature('event_management'), getUpcomingOccurrences);
router.post('/:eventId/register', authenticateToken, resolveBranchContext, requireFeature('event_management'), registerForEvent);

// QR code routes
router.post('/:id/qr-code', authenticateToken, resolveBranchContext, authorizeRole(['admin', 'pastor']), requireFeature('event_management'), generateQRCode);
router.get('/:id/qr-code', authenticateToken, resolveBranchContext, requireFeature('event_management'), getQRCode);

// Service code routes (for recurring events)
router.get('/:id/service-code', authenticateToken, resolveBranchContext, getServiceCode);
router.post('/:id/service-code', authenticateToken, resolveBranchContext, authorizeRole(['admin', 'pastor']), regenerateServiceCode);

// Sharing routes (feature-gated)
router.post('/:id/share', authenticateToken, resolveBranchContext, requireFeature('event_sharing'), generateShareLink);
router.post('/:id/share/email', authenticateToken, resolveBranchContext, requireFeature('event_sharing'), shareEventByEmail);

export default router;
