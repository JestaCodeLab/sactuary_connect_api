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

const router = express.Router();

// Static routes must come before /:id to avoid conflicts
router.get('/stats/summary', authenticateToken, resolveBranchContext, requireFeature('attendance_tracking'), getAttendanceStats);
router.get('/event/:eventId/records', authenticateToken, resolveBranchContext, requireFeature('attendance_tracking'), getEventAttendanceRecords);
router.get('/event/:eventId/export', authenticateToken, resolveBranchContext, requireFeature('attendance_tracking'), exportEventAttendance);

// Download exported file
router.get('/export/download/:filename', (req, res) => {
  try {
    const { filename } = req.params;
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const exportsDir = path.join(__dirname, '../../exports');
    const filePath = path.join(exportsDir, filename);

    // Verify file is within exports directory (security check)
    if (!path.resolve(filePath).startsWith(path.resolve(exportsDir))) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    res.download(filePath);
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: 'Failed to download file' });
  }
});

// Check-in routes (QR check-in is public for guests/members)
router.post('/check-in/qr', checkInWithQR);
router.post('/check-in/manual', authenticateToken, resolveBranchContext, authorizeRole(['admin', 'pastor']), requireFeature('attendance_tracking'), manualCheckIn);

// CRUD routes
router.get('/', authenticateToken, resolveBranchContext, requireFeature('attendance_tracking'), getAllAttendance);
router.get('/:id', authenticateToken, resolveBranchContext, requireFeature('attendance_tracking'), getAttendanceById);
router.post('/', authenticateToken, resolveBranchContext, authorizeRole(['admin', 'pastor']), requireFeature('attendance_tracking'), createAttendance);
router.put('/:id', authenticateToken, resolveBranchContext, authorizeRole(['admin', 'pastor']), requireFeature('attendance_tracking'), updateAttendance);
router.delete('/:id', authenticateToken, resolveBranchContext, authorizeRole(['admin']), requireFeature('attendance_tracking'), deleteAttendance);
router.delete('/record/:id', authenticateToken, resolveBranchContext, authorizeRole(['admin', 'pastor']), requireFeature('attendance_tracking'), deleteAttendanceRecord);

export default router;
