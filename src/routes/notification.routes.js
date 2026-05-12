import { Router } from 'express';
import * as controller from '../controllers/notification.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

const router = Router();

// Ambil daftar notifikasi user yang sedang login
router.get('/', authMiddleware, controller.getNotifications);

// Tandai notifikasi milik user yang sedang login sebagai sudah dibaca
router.patch('/:id/read', authMiddleware, controller.markNotificationAsRead);

// Endpoint untuk test push notification
router.post('/test', authMiddleware, controller.testNotification);

export default router;
