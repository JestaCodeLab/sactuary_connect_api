import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  getAllAttendance,
  getAttendanceById,
  createAttendance,
  updateAttendance,
  deleteAttendance,
  deleteAttendanceRecord,
  getAttendanceStats,
  checkInWithQR,
  getEventAttendanceRecords,
  manualCheckIn,
  exportEventAttendance,
} from '../controllers/attendanceController.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';
import { resolveBranchContext } from '../middleware/branchContext.js';
import { requireFeature } from '../middleware/featureGate.js';
import { publicCheckInLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

// Static routes must come before /:id to avoid conflicts
router.get('/stats/summary', authenticateToken, resolveBranchContext, requireFeature('attendance_tracking'), getAttendanceStats);
router.get('/event/:eventId/records', authenticateToken, resolveBranchContext, requireFeature('attendance_tracking'), getEventAttendanceRecords);
router.get('/event/:eventId/export', authenticateToken, resolveBranchContext, requireFeature('attendance_tracking'), exportEventAttendance);

// Check-in routes (QR check-in is public for guests/members)
router.post('/check-in/qr', publicCheckInLimiter, checkInWithQR);
router.post('/check-in/manual', authenticateToken, resolveBranchContext, authorizeRole(['admin', 'pastor']), requireFeature('attendance_tracking'), manualCheckIn);

// CRUD routes
router.get('/', authenticateToken, resolveBranchContext, requireFeature('attendance_tracking'), getAllAttendance);
router.get('/:id', authenticateToken, resolveBranchContext, requireFeature('attendance_tracking'), getAttendanceById);
router.post('/', authenticateToken, resolveBranchContext, authorizeRole(['admin', 'pastor']), requireFeature('attendance_tracking'), createAttendance);
router.put('/:id', authenticateToken, resolveBranchContext, authorizeRole(['admin', 'pastor']), requireFeature('attendance_tracking'), updateAttendance);
router.delete('/:id', authenticateToken, resolveBranchContext, authorizeRole(['admin']), requireFeature('attendance_tracking'), deleteAttendance);
router.delete('/record/:id', authenticateToken, resolveBranchContext, authorizeRole(['admin', 'pastor']), requireFeature('attendance_tracking'), deleteAttendanceRecord);

export default router;
