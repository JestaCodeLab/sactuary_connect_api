import Notification from '../models/Notification.js';
import notificationService from '../services/notificationService.js';

/**
 * Get all notifications for current user
 */
export const getNotifications = async (req, res) => {
  try {
    const { userId } = req.user;
    const { organizationId } = req;
    const { limit = 20, skip = 0, unreadOnly = false } = req.query;

    const result = await notificationService.getNotifications(userId, organizationId, {
      limit: parseInt(limit),
      skip: parseInt(skip),
      unreadOnly: unreadOnly === 'true',
    });

    res.json(result);
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Get unread count
 */
export const getUnreadCount = async (req, res) => {
  try {
    const { userId } = req.user;
    const { organizationId } = req;

    const unreadCount = await notificationService.getUnreadCount(userId, organizationId);

    res.json({ unreadCount });
  } catch (error) {
    console.error('Error fetching unread count:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Mark a notification as read
 */
export const markAsRead = async (req, res) => {
  try {
    const { notificationId } = req.params;
    const { userId } = req.user;

    // Verify notification belongs to this user
    const notification = await Notification.findOne({
      _id: notificationId,
      userId,
    });

    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    const updated = await notificationService.markAsRead(notificationId);
    res.json(updated);
  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Mark multiple notifications as read
 */
export const markMultipleAsRead = async (req, res) => {
  try {
    const { notificationIds } = req.body;
    const { userId } = req.user;
    const { organizationId } = req;

    // Verify all notifications belong to this user
    const count = await Notification.countDocuments({
      _id: { $in: notificationIds },
      userId,
      organizationId,
    });

    if (count !== notificationIds.length) {
      return res.status(403).json({ error: 'Some notifications do not belong to this user' });
    }

    await notificationService.markMultipleAsRead(notificationIds);
    res.json({ message: 'Notifications marked as read' });
  } catch (error) {
    console.error('Error marking multiple notifications as read:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Mark all notifications as read
 */
export const markAllAsRead = async (req, res) => {
  try {
    const { userId } = req.user;
    const { organizationId } = req;

    await notificationService.markAllAsRead(userId, organizationId);
    res.json({ message: 'All notifications marked as read' });
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Delete a notification
 */
export const deleteNotification = async (req, res) => {
  try {
    const { notificationId } = req.params;
    const { userId } = req.user;

    // Verify notification belongs to this user
    const notification = await Notification.findOne({
      _id: notificationId,
      userId,
    });

    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    await notificationService.deleteNotification(notificationId);
    res.json({ message: 'Notification deleted' });
  } catch (error) {
    console.error('Error deleting notification:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Clear all notifications
 */
export const clearAllNotifications = async (req, res) => {
  try {
    const { userId } = req.user;
    const { organizationId } = req;

    await notificationService.clearAllNotifications(userId, organizationId);
    res.json({ message: 'All notifications cleared' });
  } catch (error) {
    console.error('Error clearing notifications:', error);
    res.status(500).json({ error: error.message });
  }
};

export default {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markMultipleAsRead,
  markAllAsRead,
  deleteNotification,
  clearAllNotifications,
};
