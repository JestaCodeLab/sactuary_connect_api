import express from 'express';
import {
  getAllAttendance,
  getAttendanceById,
  createAttendance,
  updateAttendance,
  deleteAttendance,
  getAttendanceStats,
  checkInWithQR,
  getEventAttendanceRecords,
  manualCheckIn,
} from '../controllers/attendanceController.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';
import { resolveBranchContext } from '../middleware/branchContext.js';

const router = express.Router();

router.get('/stats/summary', authenticateToken, resolveBranchContext, getAttendanceStats);
router.get('/', authenticateToken, resolveBranchContext, getAllAttendance);
router.get('/:id', authenticateToken, resolveBranchContext, getAttendanceById);
router.post('/', authenticateToken, resolveBranchContext, authorizeRole(['admin', 'pastor']), createAttendance);
router.put('/:id', authenticateToken, resolveBranchContext, authorizeRole(['admin', 'pastor']), updateAttendance);
router.delete('/:id', authenticateToken, resolveBranchContext, authorizeRole(['admin']), deleteAttendance);

// Check-in routes
router.post('/check-in/qr', authenticateToken, checkInWithQR);
router.post('/check-in/manual', authenticateToken, resolveBranchContext, authorizeRole(['admin', 'pastor']), manualCheckIn);
router.get('/event/:eventId/records', authenticateToken, resolveBranchContext, getEventAttendanceRecords);

export default router;
