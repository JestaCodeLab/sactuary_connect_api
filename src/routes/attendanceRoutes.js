import express from 'express';
import {
  getAllAttendance,
  getAttendanceById,
  createAttendance,
  updateAttendance,
  deleteAttendance,
  getAttendanceStats,
} from '../controllers/attendanceController.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';

const router = express.Router();

router.get('/stats/summary', authenticateToken, getAttendanceStats);
router.get('/', authenticateToken, getAllAttendance);
router.get('/:id', authenticateToken, getAttendanceById);
router.post('/', authenticateToken, authorizeRole(['admin', 'pastor']), createAttendance);
router.put('/:id', authenticateToken, authorizeRole(['admin', 'pastor']), updateAttendance);
router.delete('/:id', authenticateToken, authorizeRole(['admin']), deleteAttendance);

export default router;
