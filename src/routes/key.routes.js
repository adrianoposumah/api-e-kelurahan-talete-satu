import { Router } from 'express';
import keyController from '../controllers/key.controller.js';
import { authMiddleware, requireRole } from '../middleware/auth.middleware.js';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// ==================== LURAH KEY MANAGEMENT ====================

// POST /keys/generate - Generate new key pair (Lurah only)
router.post('/generate', requireRole('lurah'), keyController.generateKey.bind(keyController));

// GET /keys/status - Check key status (Lurah only)
router.get('/status', requireRole('lurah'), keyController.getKeyStatus.bind(keyController));

// POST /keys/revoke - Revoke current key (Lurah only)
router.post('/revoke', requireRole('lurah'), keyController.revokeKey.bind(keyController));

export default router;
