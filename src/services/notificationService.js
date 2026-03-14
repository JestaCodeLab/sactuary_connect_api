import Notification from '../models/Notification.js';
import smsService from './smsService.js';

/**
 * NotificationService - Handles creation and delivery of notifications
 */
class NotificationService {
  /**
   * Create a notification for a user
   */
  static async createNotification(
    userId,
    organizationId,
    type,
    title,
    message,
    options = {}
  ) {
    try {
      const notification = new Notification({
        userId,
        organizationId,
        type,
        title,
        message,
        data: options.data || {},
        channels: options.channels || { inApp: true, sms: false, email: false },
        priority: options.priority || 'medium',
        relatedModel: options.relatedModel,
        relatedModelId: options.relatedModelId,
        actionUrl: options.actionUrl,
      });

      await notification.save();

      // Deliver notification through enabled channels
      await this.deliverNotification(notification);

      return notification;
    } catch (error) {
      console.error('Error creating notification:', error);
      throw error;
    }
  }

  /**
   * Create notifications for multiple users
   */
  static async createBulkNotifications(userIds, organizationId, type, title, message, options = {}) {
    try {
      const notifications = [];

      for (const userId of userIds) {
        const notification = await this.createNotification(
          userId,
          organizationId,
          type,
          title,
          message,
          options
        );
        notifications.push(notification);
      }

      return notifications;
    } catch (error) {
      console.error('Error creating bulk notifications:', error);
      throw error;
    }
  }

  /**
   * Deliver notification through enabled channels
   */
  static async deliverNotification(notification) {
    try {
      // Mark in-app as sent immediately (it's available on dashboard)
      if (notification.channels.inApp) {
        await Notification.findByIdAndUpdate(notification._id, {
          'deliveryStatus.inApp': 'sent',
        });
      }

      // Send SMS if enabled
      if (notification.channels.sms) {
        try {
          // Need to fetch user to get phone number
          const User = (await import('../models/User.js')).default;
          const user = await User.findById(notification.userId).select('phone');

          if (user && user.phone) {
            const smsResult = await smsService.sendSms(
              user.phone,
              notification.message,
              notification.organizationId
            );

            await Notification.findByIdAndUpdate(notification._id, {
              'deliveryStatus.sms': smsResult.success ? 'sent' : 'failed',
            });
          } else {
            await Notification.findByIdAndUpdate(notification._id, {
              'deliveryStatus.sms': 'failed',
            });
          }
        } catch (smsError) {
          console.error('Error sending SMS notification:', smsError);
          await Notification.findByIdAndUpdate(notification._id, {
            'deliveryStatus.sms': 'failed',
          });
        }
      }

      // Email notifications - future enhancement
      // For now, mark as skipped
      if (notification.channels.email) {
        await Notification.findByIdAndUpdate(notification._id, {
          'deliveryStatus.email': 'skipped',
        });
      }
    } catch (error) {
      console.error('Error delivering notification:', error);
    }
  }

  /**
   * Mark notification as read
   */
  static async markAsRead(notificationId) {
    try {
      return await Notification.findByIdAndUpdate(
        notificationId,
        {
          read: true,
          readAt: new Date(),
        },
        { new: true }
      );
    } catch (error) {
      console.error('Error marking notification as read:', error);
      throw error;
    }
  }

  /**
   * Mark multiple notifications as read
   */
  static async markMultipleAsRead(notificationIds) {
    try {
      return await Notification.updateMany(
        { _id: { $in: notificationIds } },
        {
          read: true,
          readAt: new Date(),
        }
      );
    } catch (error) {
      console.error('Error marking notifications as read:', error);
      throw error;
    }
  }

  /**
   * Mark all notifications as read for a user
   */
  static async markAllAsRead(userId, organizationId) {
    try {
      return await Notification.updateMany(
        { userId, organizationId, read: false },
        {
          read: true,
          readAt: new Date(),
        }
      );
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
      throw error;
    }
  }

  /**
   * Delete a notification
   */
  static async deleteNotification(notificationId) {
    try {
      return await Notification.findByIdAndDelete(notificationId);
    } catch (error) {
      console.error('Error deleting notification:', error);
      throw error;
    }
  }

  /**
   * Get unread count for a user
   */
  static async getUnreadCount(userId, organizationId) {
    try {
      return await Notification.countDocuments({
        userId,
        organizationId,
        read: false,
      });
    } catch (error) {
      console.error('Error getting unread count:', error);
      throw error;
    }
  }

  /**
   * Get notifications with pagination
   */
  static async getNotifications(userId, organizationId, options = {}) {
    try {
      const { limit = 20, skip = 0, unreadOnly = false } = options;

      const query = {
        userId,
        organizationId,
      };

      if (unreadOnly) {
        query.read = false;
      }

      const notifications = await Notification.find(query)
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip(skip);

      const total = await Notification.countDocuments(query);

      return {
        notifications,
        total,
        limit,
        skip,
        hasMore: skip + limit < total,
      };
    } catch (error) {
      console.error('Error getting notifications:', error);
      throw error;
    }
  }

  /**
   * Clear all notifications for a user
   */
  static async clearAllNotifications(userId, organizationId) {
    try {
      return await Notification.deleteMany({
        userId,
        organizationId,
      });
    } catch (error) {
      console.error('Error clearing notifications:', error);
      throw error;
    }
  }
}

export default NotificationService;
