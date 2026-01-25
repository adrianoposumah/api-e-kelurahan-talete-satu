import { Router } from 'express';
import userController from '../controllers/user.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

const router = Router();

// GET /users/me - Get current user profile (protected)
router.get('/me', authMiddleware, userController.getProfile.bind(userController));

// PATCH /users/me - Update current user profile (protected)
router.patch('/me', authMiddleware, userController.updateProfile.bind(userController));

export default router;
