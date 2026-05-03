import prisma from '../config/prisma.js';
import * as notificationService from '../services/notification.service.js';


export const testNotification = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { title = "Test Notification", body = "This is a test notification from the API!" } = req.body;

    const result = await notificationService.sendToUser(userId, { title, body });
    
    if (!result) {
      return res.status(404).json({ message: "User doesn't have an FCM token registered." });
    }

    res.json({ success: true, message: "Test notification sent!", result });
  } catch (err) {
    res.status(500).json({ message: err.message, error: err });
  }
};
