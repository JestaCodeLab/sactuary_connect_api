import express from 'express';
import {
  createTicket,
  getTickets,
  getTicketById,
  addReply,
} from '../controllers/supportController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticateToken);

// Open to any authenticated org member, regardless of role/custom permissions -
// this is a channel to the platform, not an org-management capability.
router.get('/', getTickets);
router.get('/:id', getTicketById);
router.post('/', createTicket);
router.post('/:id/replies', addReply);

export default router;
