import { existsSync, mkdirSync } from 'fs';
import { dirname, extname, join, relative, sep } from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { MAX_FILE_SIZE, ALLOWED_MIMES } from './upload.middleware.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROJECT_ROOT = join(__dirname, '..', '..');
const ARSIP_UPLOADS_ROOT = join(PROJECT_ROOT, 'uploads', 'arsip');

const ensureDir = (dirPath) => {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
};

const toPosixPath = (filePath) => filePath.split(sep).join('/');

const storage = multer.diskStorage({
  destination(req, file, cb) {
    if (!req.arsipUploadId) {
      req.arsipUploadId = uuidv4();
    }

    const dir = join(ARSIP_UPLOADS_ROOT, req.arsipUploadId);
    ensureDir(dir);
    cb(null, dir);
  },
  filename(req, file, cb) {
    const extension = extname(file.originalname || '').toLowerCase();
    cb(null, `lampiran-${Date.now()}-${Math.round(Math.random() * 1e9)}${extension}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter(req, file, cb) {
    if (!ALLOWED_MIMES.has(file.mimetype)) {
      cb(new Error("Unsupported file type for 'file'. Only JPEG, PNG, and PDF are allowed."));
      return;
    }

    cb(null, true);
  },
});

/**
 * Single optional attachment ('file') for arsip surat. Stores the file under
 * uploads/arsip/<uuid>/ and rewrites req.file.path to a POSIX-relative path so
 * it can be persisted and resolved the same way submission documents are.
 */
export const arsipUploadMiddleware = (req, res, next) => {
  upload.single('file')(req, res, (error) => {
    if (error) {
      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: ['File size exceeds 5MB limit'],
        });
      }

      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: [error.message],
      });
    }

    if (req.file?.path) {
      req.file.path = toPosixPath(relative(PROJECT_ROOT, req.file.path));
    }

    next();
  });
};

export default arsipUploadMiddleware;
