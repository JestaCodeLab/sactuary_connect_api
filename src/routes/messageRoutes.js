import express from 'express';
import {
  getAllMessages,
  getMessageById,
  createMessage,
  updateMessage,
  deleteMessage,
} from '../controllers/messageController.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';
import { resolveBranchContext } from '../middleware/branchContext.js';

const router = express.Router();

router.get('/', authenticateToken, resolveBranchContext, getAllMessages);
router.get('/:id', authenticateToken, resolveBranchContext, getMessageById);
router.post('/', authenticateToken, resolveBranchContext, authorizeRole(['admin', 'pastor']), createMessage);
router.put('/:id', authenticateToken, resolveBranchContext, authorizeRole(['admin', 'pastor']), updateMessage);
router.delete('/:id', authenticateToken, resolveBranchContext, authorizeRole(['admin']), deleteMessage);

export default router;
