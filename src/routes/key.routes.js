import { Router } from 'express';
import keyController from '../controllers/key.controller.js';
import { authMiddleware, requireRole } from '../middleware/auth.middleware.js';

const router = Router();

// ==================== PUBLIC ROUTES (for verification) ====================

// GET /keys/public/current - Get current active Lurah's public key
router.get('/public/current', keyController.getCurrentPublicKey.bind(keyController));

// GET /keys/public/:verificationCode - Get public key for a specific letter
router.get('/public/:verificationCode', keyController.getPublicKeyByLetter.bind(keyController));

// ==================== AUTHENTICATED ROUTES ====================

// Apply auth middleware for remaining routes
router.use(authMiddleware);

// ==================== LURAH KEY MANAGEMENT ====================

// POST /keys/generate - Generate new key pair (Lurah only)
router.post('/generate', requireRole('lurah'), keyController.generateKey.bind(keyController));

// GET /keys/status - Check key status (Lurah only)
router.get('/status', requireRole('lurah'), keyController.getKeyStatus.bind(keyController));

// POST /keys/revoke - Revoke current key (Lurah only)
router.post('/revoke', requireRole('lurah'), keyController.revokeKey.bind(keyController));

export default router;
