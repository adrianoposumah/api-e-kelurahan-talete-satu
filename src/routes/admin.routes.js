import { Router } from 'express';
import adminController from '../controllers/admin.controller.js';
import { authMiddleware, requireRole } from '../middleware/auth.middleware.js';

const router = Router();

// Apply admin middleware to all routes
router.use(authMiddleware, requireRole('admin'));

// ==================== USER MANAGEMENT ====================

// GET /admin/users - Get all users with pagination
router.get('/users', adminController.getUsers.bind(adminController));

// GET /admin/users/:id - Get user by ID
router.get('/users/:id', adminController.getUserById.bind(adminController));

// ==================== VALIDATE REQUESTS ====================

// GET /admin/validate-requests - Get all validation requests with pagination
router.get('/validate-requests', adminController.getValidateRequests.bind(adminController));

// GET /admin/validate-requests/:id - Get validation request by ID
router.get('/validate-requests/:id', adminController.getValidateRequestById.bind(adminController));

// PATCH /admin/validate-requests/:id - Process validation request
router.patch('/validate-requests/:id', adminController.processValidateRequest.bind(adminController));

// ==================== LURAH MANAGEMENT ====================

// GET /admin/lurah - Get current Lurah
router.get('/lurah', adminController.getCurrentLurah.bind(adminController));

// POST /admin/lurah - Set a user as Lurah (demotes current Lurah if exists)
router.post('/lurah', adminController.setLurah.bind(adminController));

// DELETE /admin/lurah - Demote current Lurah to warga
router.delete('/lurah', adminController.demoteLurah.bind(adminController));

export default router;
