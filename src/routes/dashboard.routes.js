import { Router } from 'express';
import dashboardController from '../controllers/dashboard.controller.js';
import { authMiddleware, requireRole } from '../middleware/auth.middleware.js';

const router = Router();

// Dashboard statistics are available to admin & staff (the only login roles).
router.use(authMiddleware, requireRole('admin', 'staff'));

// GET /dashboard/overview - Aggregated statistics for the home dashboard
router.get('/overview', dashboardController.getOverview.bind(dashboardController));

export default router;
