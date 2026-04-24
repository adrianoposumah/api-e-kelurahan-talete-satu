import { Router } from 'express';
import submissionController from '../controllers/submission.controller.js';
import { authMiddleware, requireRole } from '../middleware/auth.middleware.js';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// ==================== CITIZEN (WARGA) ROUTES ====================

// POST /submissions - Create a new submission (warga only)
router.post('/', requireRole('warga'), submissionController.createSubmission.bind(submissionController));

// GET /submissions - Get own submissions (warga only)
router.get('/', requireRole('warga'), submissionController.getMySubmissions.bind(submissionController));

// GET /submissions/:id - Get submission by ID (owner, kepling of lingkungan, lurah, admin)
router.get('/:id', requireRole('warga', 'kepling', 'lurah', 'sekertaris', 'admin'), submissionController.getSubmissionById.bind(submissionController));

// POST /submissions/:id/documents - Add document to submission (owner only)
router.post('/:id/documents', requireRole('warga'), submissionController.addDocument.bind(submissionController));

// DELETE /submissions/:id - Delete submission (owner only, pending_kepling status only)
router.delete('/:id', requireRole('warga'), submissionController.deleteSubmission.bind(submissionController));

// ==================== KEPLING ROUTES ====================

// GET /submissions/kepling/list - Get submissions for kepling's lingkungan
router.get('/kepling/list', requireRole('kepling'), submissionController.getSubmissionsForKepling.bind(submissionController));

// PATCH /submissions/:id/documents/:documentId/verify - Verify document
router.patch('/:id/documents/:documentId/verify', requireRole('kepling'), submissionController.verifyDocument.bind(submissionController));

// POST /submissions/:id/kepling/approve - Approve by kepling
router.post('/:id/kepling/approve', requireRole('kepling'), submissionController.approveByKepling.bind(submissionController));

// POST /submissions/:id/kepling/reject - Reject by kepling
router.post('/:id/kepling/reject', requireRole('kepling'), submissionController.rejectByKepling.bind(submissionController));

// ==================== LURAH ROUTES ====================

// GET /submissions/lurah/list - Get all submissions for lurah
router.get('/lurah/list', requireRole('lurah', 'sekertaris'), submissionController.getSubmissionsForLurah.bind(submissionController));

// POST /submissions/:id/lurah/approve - Approve by lurah
router.post('/:id/lurah/approve', requireRole('lurah', 'sekertaris'), submissionController.approveByLurah.bind(submissionController));

// POST /submissions/:id/lurah/reject - Reject by lurah
router.post('/:id/lurah/reject', requireRole('lurah', 'sekertaris'), submissionController.rejectByLurah.bind(submissionController));

// ==================== ADMIN ROUTES ====================

// POST /submissions/:id/issue - Issue submission (admin only)
router.post('/:id/issue', requireRole('admin'), submissionController.issueSubmission.bind(submissionController));

export default router;
