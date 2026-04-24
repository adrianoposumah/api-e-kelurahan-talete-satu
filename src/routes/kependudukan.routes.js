import { Router } from 'express';
import kependudukanController from '../controllers/kependudukan.controller.js';
import { authMiddleware, requireRole } from '../middleware/auth.middleware.js';

const router = Router();

// Only staff, admin, lurah, and sekertaris can access this resource
router.use(authMiddleware, requireRole('staff', 'admin', 'lurah', 'sekertaris'));

// GET /data-kependudukan - Get all data kependudukan
router.get('/', kependudukanController.getAllData.bind(kependudukanController));

// GET /data-kependudukan/:nik - Get data kependudukan by NIK
router.get('/:nik', kependudukanController.getByNik.bind(kependudukanController));

// POST /data-kependudukan - Create new data kependudukan
router.post('/', kependudukanController.createData.bind(kependudukanController));

// PATCH /data-kependudukan/:nik - Update data kependudukan
router.patch('/:nik', kependudukanController.updateData.bind(kependudukanController));

// DELETE /data-kependudukan/:nik - Delete data kependudukan
router.delete('/:nik', kependudukanController.deleteData.bind(kependudukanController));

export default router;
