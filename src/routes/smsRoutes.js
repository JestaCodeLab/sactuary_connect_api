import express from 'express';
import {
  getCreditsBalance,
  getBmsBalance,
  getCreditTransactions,
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
import { authenticateToken, authorizeRoleOrPermission } from '../middleware/auth.js';
import { resolveBranchContext } from '../middleware/branchContext.js';
import { requireFeature } from '../middleware/featureGate.js';

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);
router.use(resolveBranchContext);

// Communication permission gate: previously these routes had NO role check
// at all (any authenticated org member could send SMS if the plan included
// it) - this is a deliberate first-time tightening, not purely additive like
// the rest of this migration. See plan doc for rationale.
const commsGate = authorizeRoleOrPermission(['admin', 'pastor'], 'communication.manage');

// Credits management
router.get('/credits/balance', commsGate, requireFeature('sms_credits'), getCreditsBalance);
router.get('/credits/bms-balance', commsGate, requireFeature('sms_credits'), getBmsBalance);
router.get('/credits/transactions', commsGate, requireFeature('sms_credits'), getCreditTransactions);
router.post('/credits/initialize-payment', commsGate, requireFeature('sms_credits'), initializeSmsPayment);
router.post('/credits/verify-payment', commsGate, requireFeature('sms_credits'), verifySmsPayment);

// Send SMS
router.post('/send/single', commsGate, requireFeature('sms_credits'), sendSingleSMS);
router.post('/send/bulk', commsGate, requireFeature('sms_credits'), sendBulkSMS);
router.post('/send/members', commsGate, requireFeature('sms_credits'), sendToMembers);
router.post('/send/department', commsGate, requireFeature('sms_credits'), sendToDepartment);
router.post('/send/branch', commsGate, requireFeature('sms_credits'), sendToBranch);
router.post('/send/all', commsGate, requireFeature('sms_credits'), sendToAllMembers);

// SMS logs and analytics
router.get('/logs', commsGate, requireFeature('sms_credits'), getSmsLogs);
router.get('/logs/:id', commsGate, requireFeature('sms_credits'), getSmsLogDetails);
router.get('/analytics', commsGate, requireFeature('sms_credits'), getSmsAnalytics);

// Delivery status updates
router.post('/logs/:id/update-status', commsGate, requireFeature('sms_credits'), updateDeliveryStatus);
router.post('/logs/batch-update-status', commsGate, requireFeature('sms_credits'), batchUpdateDeliveryStatuses);

// SMS Templates
router.get('/templates', commsGate, requireFeature('sms_credits'), getTemplates);
router.get('/templates/:id', commsGate, requireFeature('sms_credits'), getTemplate);
router.post('/templates', commsGate, requireFeature('sms_credits'), createTemplate);
router.put('/templates/:id', commsGate, requireFeature('sms_credits'), updateTemplate);
router.delete('/templates/:id', commsGate, requireFeature('sms_credits'), deleteTemplate);
router.post('/templates/:id/duplicate', commsGate, requireFeature('sms_credits'), duplicateTemplate);

// Sender ID Management
router.post('/sender-id/register', commsGate, requireFeature('sms_credits'), registerSenderId);
router.post('/sender-id/status', commsGate, requireFeature('sms_credits'), checkSenderIdStatus);

// System Configuration
router.get('/config/system', getSystemConfig);

// SMS Packages (public - no auth required for browsing)
router.get('/packages', getSmsPackages);

// Utilities
router.get('/members/available', commsGate, requireFeature('sms_credits'), getAvailableMembers);
router.post('/calculate-cost', commsGate, requireFeature('sms_credits'), calculateSmsCost);

export default router;
