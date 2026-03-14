import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { resolveBranchContext } from '../middleware/branchContext.js';
import notificationController from '../controllers/notificationController.js';

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);
router.use(resolveBranchContext);

/**
 * GET /api/notifications - Get all notifications for current user
 * Query params: limit (default 20), skip (default 0), unreadOnly (default false)
 */
router.get('/', notificationController.getNotifications);

/**
 * GET /api/notifications/unread/count - Get unread notification count
 */
router.get('/unread/count', notificationController.getUnreadCount);

/**
 * PATCH /api/notifications/:notificationId/read - Mark notification as read
 */
router.patch('/:notificationId/read', notificationController.markAsRead);

/**
 * PATCH /api/notifications/read/multiple - Mark multiple notifications as read
 */
router.patch('/read/multiple', notificationController.markMultipleAsRead);

/**
 * PATCH /api/notifications/read/all - Mark all notifications as read
 */
router.patch('/read/all', notificationController.markAllAsRead);

/**
 * DELETE /api/notifications/:notificationId - Delete a notification
 */
router.delete('/:notificationId', notificationController.deleteNotification);

/**
 * DELETE /api/notifications/clear/all - Clear all notifications
 */
router.delete('/clear/all', notificationController.clearAllNotifications);

export default router;
