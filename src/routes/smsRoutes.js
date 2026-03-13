import express from 'express';
import {
  getCreditsBalance,
  getCreditTransactions,
  purchaseCredits,
  sendSingleSMS,
  sendBulkSMS,
  sendToMembers,
  sendToDepartment,
  sendToBranch,
  sendToAllMembers,
  getSmsLogs,
  getSmsLogDetails,
  getSmsAnalytics,
  getAvailableMembers,
  calculateSmsCost,
  updateDeliveryStatus,
  batchUpdateDeliveryStatuses
} from '../controllers/smsController.js';
import { authenticateToken } from '../middleware/auth.js';
import { resolveBranchContext } from '../middleware/branchContext.js';

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);
router.use(resolveBranchContext);

// Credits management
router.get('/credits/balance', getCreditsBalance);
router.get('/credits/transactions', getCreditTransactions);
router.post('/credits/purchase', purchaseCredits);

// Send SMS
router.post('/send/single', sendSingleSMS);
router.post('/send/bulk', sendBulkSMS);
router.post('/send/members', sendToMembers);
router.post('/send/department', sendToDepartment);
router.post('/send/branch', sendToBranch);
router.post('/send/all', sendToAllMembers);

// SMS logs and analytics
router.get('/logs', getSmsLogs);
router.get('/logs/:id', getSmsLogDetails);
router.get('/analytics', getSmsAnalytics);

// Delivery status updates
router.post('/logs/:id/update-status', updateDeliveryStatus);
router.post('/logs/batch-update-status', batchUpdateDeliveryStatuses);

// Utilities
router.get('/members/available', getAvailableMembers);
router.post('/calculate-cost', calculateSmsCost);

export default router;
