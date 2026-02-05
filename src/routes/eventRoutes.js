import express from 'express';
import {
  getAllEvents,
  getEventById,
  createEvent,
  updateEvent,
  deleteEvent,
  registerForEvent
} from '../controllers/eventController.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';

const router = express.Router();

router.get('/', authenticateToken, getAllEvents);
router.get('/:id', authenticateToken, getEventById);
router.post('/', authenticateToken, authorizeRole(['admin', 'pastor']), createEvent);
router.put('/:id', authenticateToken, authorizeRole(['admin', 'pastor']), updateEvent);
router.delete('/:id', authenticateToken, authorizeRole(['admin']), deleteEvent);
router.post('/:eventId/register', authenticateToken, registerForEvent);

export default router;
