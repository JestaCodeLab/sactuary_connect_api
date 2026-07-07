import express from 'express';
import { getGivingInfo, initializeGivingPayment, verifyGivingPayment } from '../controllers/publicGivingController.js';

const router = express.Router();

// Unauthenticated — consumed by a public giving link and/or the mobile app
router.get('/:organizationId/info', getGivingInfo);
router.post('/initialize', initializeGivingPayment);
router.get('/verify/:reference', verifyGivingPayment);

export default router;
