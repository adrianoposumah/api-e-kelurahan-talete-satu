import { Router } from 'express';
import keyController from '../controllers/key.controller.js';
import { authMiddleware, requireRole } from '../middleware/auth.middleware.js';

const router = Router();

// ==================== PUBLIC ROUTES ====================

// GET /keys/active - Get current active Lurah's public key
router.get('/active', keyController.getCurrentPublicKey.bind(keyController));

// GET /keys/public/:verificationCode - Get public key for a specific letter
router.get('/public/:verificationCode', keyController.getPublicKeyByLetter.bind(keyController));

// ==================== AUTHENTICATED ROUTES ====================

router.use(authMiddleware);

// ==================== LURAH KEY MANAGEMENT ====================

// POST /keys/generate - Generate new key pair (Lurah only)
router.post('/generate', requireRole('lurah'), keyController.generateKey.bind(keyController));

// GET /keys/status - Check key status (Lurah only)
router.get('/status', requireRole('lurah'), keyController.getKeyStatus.bind(keyController));

// ==================== ADMIN KEY MANAGEMENT ====================

// POST /keys/:id/revoke - Revoke a key (Admin only)
router.post('/:id/revoke', requireRole('admin'), keyController.revokeKey.bind(keyController));

// GET /keys - List all keys (Admin only)
router.get('/', requireRole('admin'), keyController.listKeys.bind(keyController));

export default router;
