import { Router } from 'express';
import authController from '../controllers/auth.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

const router = Router();

// POST /auth/register - Register new user
router.post('/register', authController.register.bind(authController));

// POST /auth/login - Login with no_hp and password
router.post('/login', authController.login.bind(authController));

// POST /auth/refresh - Refresh access token
router.post('/refresh', authController.refresh.bind(authController));

// POST /auth/logout - Logout and revoke refresh token (protected)
router.post('/logout', authMiddleware, authController.logout.bind(authController));

// POST /auth/fcm-token - Save FCM token for push notifications (protected)
router.post('/fcm-token', authMiddleware, authController.fcmToken.bind(authController));

export default router;
