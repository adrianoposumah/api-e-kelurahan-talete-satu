import { Router } from 'express';
import multer from 'multer';
import verificationController from '../controllers/verification.controller.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'application/pdf') {
      cb(new Error('Only PDF files are allowed'));
      return;
    }
    cb(null, true);
  },
});

const uploadPdf = (req, res, next) => {
  upload.single('file')(req, res, (error) => {
    if (!error) {
      next();
      return;
    }

    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({
        success: false,
        message: 'Maximum file size is 10MB',
      });
      return;
    }

    res.status(400).json({
      success: false,
      message: error.message,
    });
  });
};

// Public endpoint: verify stored server PDF by verification code
router.post('/code', verificationController.verifyByCode.bind(verificationController));
router.get('/code/:verificationCode', verificationController.verifyByCode.bind(verificationController));

// Public endpoint: POST /verify
router.post('/', uploadPdf, verificationController.verify.bind(verificationController));

export default router;
