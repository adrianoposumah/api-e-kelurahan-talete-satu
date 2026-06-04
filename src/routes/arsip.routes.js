import { Router } from 'express';
import arsipController from '../controllers/arsip.controller.js';
import { authMiddleware, requireRole } from '../middleware/auth.middleware.js';
import { arsipUploadMiddleware } from '../middleware/arsip-upload.middleware.js';

const router = Router();

// All arsip routes require authentication and are limited to staff & admin
router.use(authMiddleware);
router.use(requireRole('staff', 'admin'));

// GET /arsip/log - Unified archive log (manual entries + system issued letters)
router.get('/log', arsipController.getUnifiedLog.bind(arsipController));

// POST /arsip - Create a manual arsip surat (tambah surat masuk/keluar)
router.post('/', arsipUploadMiddleware, arsipController.create.bind(arsipController));

// GET /arsip - List manual arsip entries
router.get('/', arsipController.list.bind(arsipController));

// GET /arsip/:id/file - Serve/download the arsip attachment
router.get('/:id/file', arsipController.serveFile.bind(arsipController));

// GET /arsip/:id - Get a single arsip entry
router.get('/:id', arsipController.getById.bind(arsipController));

// PATCH /arsip/:id - Update an arsip entry
router.patch('/:id', arsipUploadMiddleware, arsipController.update.bind(arsipController));

// DELETE /arsip/:id - Delete an arsip entry
router.delete('/:id', arsipController.remove.bind(arsipController));

export default router;
