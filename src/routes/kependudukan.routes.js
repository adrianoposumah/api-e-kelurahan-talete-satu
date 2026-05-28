import { Router } from 'express';
import multer from 'multer';
import kependudukanController from '../controllers/kependudukan.controller.js';
import { authMiddleware, requireRole } from '../middleware/auth.middleware.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const fileName = file.originalname.toLowerCase();
    if (!fileName.endsWith('.xlsx')) {
      cb(new Error('Hanya file .xlsx yang diperbolehkan'));
      return;
    }
    cb(null, true);
  },
});

const uploadBatchXlsx = (req, res, next) => {
  upload.single('file')(req, res, (error) => {
    if (!error) {
      next();
      return;
    }

    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Ukuran file maksimal 5MB',
      });
      return;
    }

    res.status(400).json({
      error: 'Bad Request',
      message: error.message,
    });
  });
};

// Authenticated users can access masked NIK and nama only
router.get('/masked', authMiddleware, kependudukanController.getMaskedKependudukan.bind(kependudukanController));

// Only staff, admin, lurah, and sekertaris can access this resource
router.use(authMiddleware, requireRole('staff', 'admin', 'lurah', 'sekertaris'));

// GET /data-kependudukan - Get all data kependudukan
router.get('/', kependudukanController.getAllData.bind(kependudukanController));

// POST /data-kependudukan/batch-upload - Batch add data from xlsx
router.post('/batch-upload', uploadBatchXlsx, kependudukanController.batchCreateData.bind(kependudukanController));

// GET /data-kependudukan/:nik - Get data kependudukan by NIK
router.get('/:nik', kependudukanController.getByNik.bind(kependudukanController));

// POST /data-kependudukan - Create new data kependudukan
router.post('/', kependudukanController.createData.bind(kependudukanController));

// PATCH /data-kependudukan/:nik - Update data kependudukan
router.patch('/:nik', kependudukanController.updateData.bind(kependudukanController));

// DELETE /data-kependudukan/:nik - Delete data kependudukan
router.delete('/:nik', kependudukanController.deleteData.bind(kependudukanController));

export default router;
