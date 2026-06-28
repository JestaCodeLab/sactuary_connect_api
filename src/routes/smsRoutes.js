import express from 'express';
import {
  getCreditsBalance,
  getBmsBalance,
  getCreditTransactions,
  purchaseCredits,
  initializeSmsPayment,
  verifySmsPayment,
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
  batchUpdateDeliveryStatuses,
  registerSenderId,
  checkSenderIdStatus,
  getSystemConfig,
  getSmsPackages
} from '../controllers/smsController.js';
import {
  getTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  duplicateTemplate
} from '../controllers/smsTemplateController.js';
import { authenticateToken } from '../middleware/auth.js';
import { resolveBranchContext } from '../middleware/branchContext.js';
import { requireFeature } from '../middleware/featureGate.js';

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);
router.use(resolveBranchContext);

// Credits management
router.get('/credits/balance', requireFeature('sms_credits'), getCreditsBalance);
router.get('/credits/bms-balance', requireFeature('sms_credits'), getBmsBalance);
router.get('/credits/transactions', requireFeature('sms_credits'), getCreditTransactions);
router.post('/credits/purchase', requireFeature('sms_credits'), purchaseCredits);
router.post('/credits/initialize-payment', requireFeature('sms_credits'), initializeSmsPayment);
router.post('/credits/verify-payment', requireFeature('sms_credits'), verifySmsPayment);

// Send SMS
router.post('/send/single', requireFeature('sms_credits'), sendSingleSMS);
router.post('/send/bulk', requireFeature('sms_credits'), sendBulkSMS);
router.post('/send/members', requireFeature('sms_credits'), sendToMembers);
router.post('/send/department', requireFeature('sms_credits'), sendToDepartment);
router.post('/send/branch', requireFeature('sms_credits'), sendToBranch);
router.post('/send/all', requireFeature('sms_credits'), sendToAllMembers);

// SMS logs and analytics
router.get('/logs', requireFeature('sms_credits'), getSmsLogs);
router.get('/logs/:id', requireFeature('sms_credits'), getSmsLogDetails);
router.get('/analytics', requireFeature('sms_credits'), getSmsAnalytics);

// Delivery status updates
router.post('/logs/:id/update-status', requireFeature('sms_credits'), updateDeliveryStatus);
router.post('/logs/batch-update-status', requireFeature('sms_credits'), batchUpdateDeliveryStatuses);

// SMS Templates
router.get('/templates', requireFeature('sms_credits'), getTemplates);
router.get('/templates/:id', requireFeature('sms_credits'), getTemplate);
router.post('/templates', requireFeature('sms_credits'), createTemplate);
router.put('/templates/:id', requireFeature('sms_credits'), updateTemplate);
router.delete('/templates/:id', requireFeature('sms_credits'), deleteTemplate);
router.post('/templates/:id/duplicate', requireFeature('sms_credits'), duplicateTemplate);

// Sender ID Management
router.post('/sender-id/register', requireFeature('sms_credits'), registerSenderId);
router.post('/sender-id/status', requireFeature('sms_credits'), checkSenderIdStatus);

// System Configuration
router.get('/config/system', getSystemConfig);

// SMS Packages (public - no auth required for browsing)
router.get('/packages', getSmsPackages);

// Utilities
router.get('/members/available', requireFeature('sms_credits'), getAvailableMembers);
router.post('/calculate-cost', requireFeature('sms_credits'), calculateSmsCost);

export default router;
