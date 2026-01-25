import { Router } from 'express';
import validateController from '../controllers/validate.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

const router = Router();

// POST /validate-requests - Create a validation request (protected)
router.post('/', authMiddleware, validateController.create.bind(validateController));

// GET /validate-requests/me - Get current user's validation requests (protected)
router.get('/me', authMiddleware, validateController.getMyRequests.bind(validateController));

export default router;
