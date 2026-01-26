import { Router } from 'express';
import lingkunganController from '../controllers/lingkungan.controller.js';
import { authMiddleware, requireRole } from '../middleware/auth.middleware.js';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// Lingkungan CRUD - Admin and Lurah only
// GET /lingkungan - Get all lingkungan
router.get('/', lingkunganController.getAllLingkungan.bind(lingkunganController));

// GET /lingkungan/kepling - Get all kepling assignments
router.get('/kepling', requireRole('admin', 'lurah'), lingkunganController.getAllKeplingAssignments.bind(lingkunganController));

// GET /lingkungan/kepling/active - Get all active kepling users
router.get('/kepling/active', requireRole('admin', 'lurah'), lingkunganController.getActiveKeplings.bind(lingkunganController));

// GET /lingkungan/kepling/user/:userId - Get kepling history by user
router.get('/kepling/user/:userId', requireRole('admin', 'lurah'), lingkunganController.getKeplingHistoryByUser.bind(lingkunganController));

// POST /lingkungan/kepling - Assign kepling to lingkungan (Admin only)
router.post('/kepling', requireRole('admin'), lingkunganController.assignKepling.bind(lingkunganController));

// PATCH /lingkungan/kepling/:id/end - End kepling assignment (Admin only)
router.patch('/kepling/:id/end', requireRole('admin'), lingkunganController.endKeplingAssignment.bind(lingkunganController));

// GET /lingkungan/:id - Get lingkungan by ID
router.get('/:id', lingkunganController.getLingkunganById.bind(lingkunganController));

// POST /lingkungan - Create new lingkungan (Admin only)
router.post('/', requireRole('admin'), lingkunganController.createLingkungan.bind(lingkunganController));

// PATCH /lingkungan/:id - Update lingkungan (Admin only)
router.patch('/:id', requireRole('admin'), lingkunganController.updateLingkungan.bind(lingkunganController));

// DELETE /lingkungan/:id - Delete lingkungan (Admin only)
router.delete('/:id', requireRole('admin'), lingkunganController.deleteLingkungan.bind(lingkunganController));

export default router;
