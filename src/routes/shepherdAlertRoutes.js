import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { resolveBranchContext } from '../middleware/branchContext.js';
import { requireFeature } from '../middleware/featureGate.js';
import {
  getShepherdAlerts,
  getShepherdAlert,
  createShepherdAlert,
  updateShepherdAlert,
  deleteShepherdAlert,
  toggleShepherdAlert,
  runShepherdAlertCheck,
  getShepherdAlertLogs,
} from '../controllers/shepherdAlertController.js';

const router = express.Router();

// All routes require authentication, branch context, and the shepherd_alerts feature
router.use(authenticateToken);
router.use(resolveBranchContext);
router.use(requireFeature('ai_shepherd_alerts'));

// Special routes first (before :id route)
router.get('/logs/list', getShepherdAlertLogs);

// Get all alerts
router.get('/', getShepherdAlerts);

// Get specific alert
router.get('/:id', getShepherdAlert);

// Create new alert
router.post('/', createShepherdAlert);

// Update alert
router.patch('/:id', updateShepherdAlert);

// Delete alert
router.delete('/:id', deleteShepherdAlert);

// Toggle active status
router.patch('/:id/toggle', toggleShepherdAlert);

// Run alert check manually
router.post('/:id/run', runShepherdAlertCheck);

export default router;
