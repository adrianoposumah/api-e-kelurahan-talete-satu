import { Router } from 'express';
import submissionController from '../controllers/submission.controller.js';
import { authMiddleware, requireRole } from '../middleware/auth.middleware.js';
import { dynamicUploadMiddleware } from '../middleware/upload.middleware.js';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// ==================== CITIZEN (WARGA) ROUTES ====================

// POST /submissions - Create a new submission (warga only)
router.post('/', requireRole('warga'), dynamicUploadMiddleware, submissionController.createSubmission.bind(submissionController));

// GET /submissions - Get own submissions (warga only)
router.get('/', requireRole('warga'), submissionController.getMySubmissions.bind(submissionController));

// GET /submissions/user/:id - Get own submission detail by ID (warga only)
router.get('/user/:id', requireRole('warga'), submissionController.getSubmissionUserDetailById.bind(submissionController));

// DELETE /submissions/:id - Delete submission (owner only, pending_kepling status only)
router.delete('/:id', requireRole('warga'), submissionController.deleteSubmission.bind(submissionController));

// ==================== KEPLING ROUTES ====================

// GET /submissions/kepling/list - Get submissions for kepling's lingkungan
router.get('/kepling/list', requireRole('kepling'), submissionController.getSubmissionsForKepling.bind(submissionController));

// GET /submissions/kepling/:id - Get submission detail by ID for kepling
router.get('/kepling/:id', requireRole('kepling'), submissionController.getSubmissionKeplingDetailById.bind(submissionController));

// POST /submissions/:id/kepling/approve - Approve by kepling
router.post('/:id/kepling/approve', requireRole('kepling'), submissionController.approveByKepling.bind(submissionController));

// POST /submissions/:id/kepling/reject - Reject by kepling
router.post('/:id/kepling/reject', requireRole('kepling'), submissionController.rejectByKepling.bind(submissionController));

// ==================== LURAH ROUTES ====================

// GET /submissions/lurah/list - Get all submissions for lurah
router.get('/lurah/list', requireRole('lurah', 'sekertaris'), submissionController.getSubmissionsForLurah.bind(submissionController));

// GET /submissions/lurah/:id - Get submission detail by ID for lurah
router.get('/lurah/:id', requireRole('lurah', 'sekertaris'), submissionController.getSubmissionLurahDetailById.bind(submissionController));

// GET /submissions/:id - Get submission by ID (owner, kepling of lingkungan, lurah, admin)
router.get('/:id', requireRole('warga', 'kepling', 'lurah', 'sekertaris', 'admin'), submissionController.getSubmissionById.bind(submissionController));

// POST /submissions/:id/lurah/approve - Approve by lurah
router.post('/:id/lurah/approve', requireRole('lurah', 'sekertaris'), submissionController.approveByLurah.bind(submissionController));

// POST /submissions/:id/lurah/reject - Reject by lurah
router.post('/:id/lurah/reject', requireRole('lurah', 'sekertaris'), submissionController.rejectByLurah.bind(submissionController));

export default router;
