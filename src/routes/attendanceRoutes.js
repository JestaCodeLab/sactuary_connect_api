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

// Static routes must come before /:id to avoid conflicts
router.get('/stats/summary', authenticateToken, resolveBranchContext, getAttendanceStats);
router.get('/event/:eventId/records', authenticateToken, resolveBranchContext, getEventAttendanceRecords);

// Check-in routes (QR check-in is public for guests/members)
router.post('/check-in/qr', checkInWithQR);
router.post('/check-in/manual', authenticateToken, resolveBranchContext, authorizeRole(['admin', 'pastor']), manualCheckIn);

// CRUD routes
router.get('/', authenticateToken, resolveBranchContext, getAllAttendance);
router.get('/:id', authenticateToken, resolveBranchContext, getAttendanceById);
router.post('/', authenticateToken, resolveBranchContext, authorizeRole(['admin', 'pastor']), createAttendance);
router.put('/:id', authenticateToken, resolveBranchContext, authorizeRole(['admin', 'pastor']), updateAttendance);
router.delete('/:id', authenticateToken, resolveBranchContext, authorizeRole(['admin']), deleteAttendance);

export default router;
