import { Router } from 'express';
import * as controller from '../controllers/notification.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

const router = Router();

// Endpoint untuk test push notification
router.post('/test', authMiddleware, controller.testNotification);

export default router;
