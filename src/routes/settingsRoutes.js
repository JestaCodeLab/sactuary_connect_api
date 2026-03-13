import express from 'express';
import {
  getBirthdaySettings,
  updateBirthdaySettings,
  resetBirthdayTemplate,
} from '../controllers/settingsController.js';
import { authenticateToken } from '../middleware/auth.js';
import { requireFeature } from '../middleware/featureGate.js';

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// Birthday settings routes
router.get('/birthday', requireFeature('birthday_notifications'), getBirthdaySettings);
router.put('/birthday', requireFeature('birthday_notifications'), updateBirthdaySettings);
router.post('/birthday/reset', requireFeature('birthday_notifications'), resetBirthdayTemplate);

export default router;
