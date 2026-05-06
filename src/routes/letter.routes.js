import { Router } from 'express';
import letterController from '../controllers/letter.controller.js';
import { authMiddleware, requireRole } from '../middleware/auth.middleware.js';

const router = Router();

// ==================== PUBLIC ROUTES ====================

// GET /letters/verify/:code - Verify letter authenticity (PUBLIC - no auth required)
router.get('/verify/:code', letterController.verifyLetter.bind(letterController));

// GET /letters/templates - Get available templates (PUBLIC)
router.get('/templates', letterController.getTemplates.bind(letterController));

// GET /letters/templates/:type - Get specific template schema (PUBLIC)
router.get('/templates/:type', letterController.getTemplateSchema.bind(letterController));

// ==================== AUTHENTICATED ROUTES ====================

// Apply auth middleware for remaining routes
router.use(authMiddleware);

// ==================== WARGA ROUTES ====================

// GET /letters - Get user's issued letters
router.get('/', requireRole('warga', 'kepling', 'lurah', 'sekertaris', 'admin'), letterController.getMyLetters.bind(letterController));



// GET /letters/:code - Get letter details by verification code
router.get('/:code', requireRole('warga', 'kepling', 'lurah', 'sekertaris', 'admin'), letterController.getLetterByCode.bind(letterController));

// GET /letters/submission/:submission_id - Get letter details by submission ID
router.get('/submission/:submission_id', requireRole('warga', 'kepling', 'lurah', 'sekertaris', 'admin'), letterController.getLetterBySubmissionId.bind(letterController));

// GET /letters/admin/all - Get all issued letters
router.get('/admin/all', requireRole('admin', 'lurah', 'sekertaris'), letterController.getAllLetters.bind(letterController));

// POST /letters/:code/revoke - Revoke a letter
router.post('/:code/revoke', requireRole('admin'), letterController.revokeLetter.bind(letterController));

export default router;
