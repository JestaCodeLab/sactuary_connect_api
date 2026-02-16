import express from 'express';
import {
  getAllMessages,
  getMessageById,
  createMessage,
  updateMessage,
  deleteMessage,
} from '../controllers/messageController.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';

const router = express.Router();

router.get('/', authenticateToken, getAllMessages);
router.get('/:id', authenticateToken, getMessageById);
router.post('/', authenticateToken, authorizeRole(['admin', 'pastor']), createMessage);
router.put('/:id', authenticateToken, authorizeRole(['admin', 'pastor']), updateMessage);
router.delete('/:id', authenticateToken, authorizeRole(['admin']), deleteMessage);

export default router;
