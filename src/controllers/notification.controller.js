import * as notificationService from '../services/notification.service.js';
import { formatNotificationResponse } from '../utils/formatters.js';

const isEnabledQuery = (value) => value !== undefined && value !== false && value !== 'false' && value !== '0';

export const getNotifications = async (req, res, next) => {
  try {
    const result = await notificationService.getUserNotifications({
      userId: req.user.userId,
      page: req.query.page,
      limit: req.query.limit,
      unreadOnly: isEnabledQuery(req.query.unread_only),
      type: req.query.type,
    });

    res.json({
      notifications: result.notifications.map(formatNotificationResponse),
      unread: result.unread,
      pagination: result.pagination,
    });
  } catch (err) {
    if (err.code === 'BAD_REQUEST') {
      return res.status(400).json({
        error: 'Bad Request',
        message: err.message,
      });
    }

    next(err);
  }
};

export const markNotificationAsRead = async (req, res, next) => {
  try {
    const notification = await notificationService.markNotificationAsRead({
      notificationId: req.params.id,
      userId: req.user.userId,
    });

    res.json({
      message: 'Notifikasi berhasil ditandai sebagai dibaca',
      notification: formatNotificationResponse(notification),
    });
  } catch (err) {
    if (err.code === 'BAD_REQUEST') {
      return res.status(400).json({
        error: 'Bad Request',
        message: err.message,
      });
    }

    if (err.code === 'NOT_FOUND') {
      return res.status(404).json({
        error: 'Not Found',
        message: err.message,
      });
    }

    next(err);
  }
};

export const testNotification = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { title = 'Test Notification', body = 'This is a test notification from the API!', data = {}, type = 'other' } = req.body;

    const result = await notificationService.sendToUser(userId, { title, body, data, type });

    res.json({
      success: true,
      message: result.pushResult ? 'Test notification sent!' : 'Test notification saved, but no FCM push was sent.',
      notification: formatNotificationResponse(result.notification),
      push_sent: Boolean(result.pushResult),
      result: result.pushResult,
    });
  } catch (err) {
    if (err.code === 'BAD_REQUEST') {
      return res.status(400).json({
        error: 'Bad Request',
        message: err.message,
      });
    }

    res.status(500).json({ message: err.message, error: err });
  }
};
