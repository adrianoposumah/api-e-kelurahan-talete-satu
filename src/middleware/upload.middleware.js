import { existsSync, mkdirSync, renameSync, rmSync } from 'fs';
import { dirname, extname, join, relative, sep } from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import loadSubmissionSchema from '../lib/schemaLoader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROJECT_ROOT = join(__dirname, '..', '..');
const UPLOADS_ROOT = join(PROJECT_ROOT, 'uploads');
const TEMP_UPLOADS_ROOT = join(UPLOADS_ROOT, '_tmp');

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'application/pdf']);

const ensureDir = (dirPath) => {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
};

const cleanupDirectory = (dirPath) => {
  if (existsSync(dirPath)) {
    rmSync(dirPath, { recursive: true, force: true });
  }
};

const toPosixPath = (filePath) => filePath.split(sep).join('/');

const tempStorage = multer.diskStorage({
  destination(req, file, cb) {
    const tmpDir = join(TEMP_UPLOADS_ROOT, req.submissionId || 'unknown');
    ensureDir(tmpDir);
    cb(null, tmpDir);
  },
  filename(req, file, cb) {
    const extension = extname(file.originalname || '').toLowerCase();
    cb(null, `${file.fieldname}-${Date.now()}-${Math.round(Math.random() * 1e9)}${extension}`);
  },
});

const tempUpload = multer({
  storage: tempStorage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter(req, file, cb) {
    if (!ALLOWED_MIMES.has(file.mimetype)) {
      cb(new Error(`Unsupported file type for '${file.fieldname}'. Only JPEG, PNG, and PDF are allowed.`));
      return;
    }

    cb(null, true);
  },
});

const buildFileMap = (filesArray) => {
  const fileMap = {};

  for (const file of filesArray) {
    if (!fileMap[file.fieldname]) {
      fileMap[file.fieldname] = [];
    }

    fileMap[file.fieldname].push(file);
  }

  return fileMap;
};

const collectFileValidationErrors = (filesByField, schema) => {
  const errors = [];
  const fileSchema = Array.isArray(schema?.files) ? schema.files : [];
  const fileConfigByName = new Map(fileSchema.map((entry) => [entry.name, { maxCount: Number(entry.maxCount) || 1 }]));

  for (const [fieldName, files] of Object.entries(filesByField)) {
    const config = fileConfigByName.get(fieldName);
    if (!config) {
      errors.push(`File field '${fieldName}' is not allowed for this letter type`);
      continue;
    }

    if (files.length > config.maxCount) {
      errors.push(`File field '${fieldName}' exceeds maxCount (${config.maxCount})`);
    }
  }

  return errors;
};

const normalizeUploadedFiles = (filesByField, letterType, submissionId) => {
  const finalDir = join(UPLOADS_ROOT, letterType, submissionId);
  ensureDir(finalDir);

  const normalizedFiles = {};
  for (const [fieldName, files] of Object.entries(filesByField)) {
    normalizedFiles[fieldName] = files.map((file) => {
      const extension = extname(file.originalname || '').toLowerCase();
      const finalName = `${fieldName}-${Date.now()}-${Math.round(Math.random() * 1e9)}${extension}`;
      const finalPath = join(finalDir, finalName);
      renameSync(file.path, finalPath);

      return {
        ...file,
        filename: finalName,
        destination: finalDir,
        path: toPosixPath(relative(PROJECT_ROOT, finalPath)),
      };
    });
  }

  return { normalizedFiles, finalDir };
};

export const dynamicUploadMiddleware = (req, res, next) => {
  req.submissionId = uuidv4();

  tempUpload.any()(req, res, (error) => {
    const tempDir = join(TEMP_UPLOADS_ROOT, req.submissionId);

    if (error) {
      cleanupDirectory(tempDir);

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

    const letterType = typeof req.body?.letter_type === 'string' ? req.body.letter_type.trim().toLowerCase() : '';

    if (!letterType) {
      cleanupDirectory(tempDir);
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: ["Field 'letter_type' is required"],
      });
    }

    const schema = loadSubmissionSchema(letterType);
    if (!schema) {
      cleanupDirectory(tempDir);
      return res.status(400).json({
        success: false,
        message: `Unknown letter type: '${letterType}'`,
      });
    }

    const uploadedArray = Array.isArray(req.files) ? req.files : [];
    const filesByField = buildFileMap(uploadedArray);
    const fileErrors = collectFileValidationErrors(filesByField, schema);

    if (fileErrors.length > 0) {
      cleanupDirectory(tempDir);
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: fileErrors,
      });
    }

    try {
      const { normalizedFiles, finalDir } = normalizeUploadedFiles(filesByField, letterType, req.submissionId);
      cleanupDirectory(tempDir);

      req.body.letter_type = letterType;
      req.files = normalizedFiles;
      req.uploadDirectory = toPosixPath(relative(PROJECT_ROOT, finalDir));

      next();
    } catch {
      cleanupDirectory(tempDir);
      cleanupDirectory(join(UPLOADS_ROOT, letterType, req.submissionId));

      return res.status(500).json({
        success: false,
        message: 'Failed to process uploaded files',
      });
    }
  });
};

export default dynamicUploadMiddleware;
