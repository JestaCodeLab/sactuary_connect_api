import express from 'express';
import { getFinanceOverview, getFinanceReport } from '../controllers/financeController.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';
import { resolveBranchContext } from '../middleware/branchContext.js';
import { requireFeature } from '../middleware/featureGate.js';

const router = express.Router();

router.get('/overview', authenticateToken, resolveBranchContext, authorizeRole(['admin', 'pastor']), requireFeature('financial_reporting'), getFinanceOverview);
router.get('/reports', authenticateToken, resolveBranchContext, authorizeRole(['admin', 'pastor']), requireFeature('advanced_financial_reporting'), getFinanceReport);

export default router;
