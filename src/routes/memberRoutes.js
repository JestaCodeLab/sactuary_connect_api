import express from 'express';
import {
  getAllMembers,
  getMemberById,
  createMember,
  updateMember,
  deleteMember
} from '../controllers/memberController.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';

const router = express.Router();

router.get('/', authenticateToken, getAllMembers);
router.get('/:id', authenticateToken, getMemberById);
router.post('/', authenticateToken, authorizeRole(['admin', 'pastor']), createMember);
router.put('/:id', authenticateToken, authorizeRole(['admin', 'pastor']), updateMember);
router.delete('/:id', authenticateToken, authorizeRole(['admin']), deleteMember);

export default router;
