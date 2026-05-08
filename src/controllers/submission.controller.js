import { createReadStream, existsSync } from 'fs';
import { basename, dirname, extname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

import submissionService from '../services/submission.service.js';
import loadSubmissionSchema from '../lib/schemaLoader.js';
import { validateSubmission } from '../validators/submission.validator.js';
import { formatSubmissionByUserResponse, formatSubmissionResponse } from '../utils/formatters.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..', '..');

const MIME_TYPES = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
};

/**
 * Submission Controller - Handles submission request/response
 */
class SubmissionController {
  buildBaseUrl(req) {
    const forwardedProto = req.headers['x-forwarded-proto'];
    const protocol = typeof forwardedProto === 'string' && forwardedProto.length > 0 ? forwardedProto.split(',')[0].trim() : req.protocol;

    return `${protocol}://${req.get('host')}`;
  }

  formatSubmissionDetail(submission, req) {
    return formatSubmissionResponse(submission, {
      baseUrl: this.buildBaseUrl(req),
    });
  }

  resolveDocumentPath(filePath) {
    return resolve(PROJECT_ROOT, filePath);
  }

  getDocumentMimeType(filePath) {
    return MIME_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream';
  }

  isDownloadRequest(req) {
    const downloadValue = String(req.query.download || '').toLowerCase();
    return downloadValue === '1' || downloadValue === 'true' || downloadValue === 'yes';
  }

  canAccessSubmission(submission, userId, userRole) {
    const isOwner = submission.userId.toString() === userId.toString();
    const isKepling = userRole === 'kepling';
    const isLurah = userRole === 'lurah';
    const isSekertaris = userRole === 'sekertaris';
    const isAdmin = userRole === 'admin';

    if (isKepling && !isOwner) {
      const hasAccess = submission.lingkungan.keplings?.some((k) => k.userId.toString() === userId.toString());
      return hasAccess;
    }

    if (userRole === 'warga') {
      return isOwner;
    }

    return isOwner || isKepling || isLurah || isSekertaris || isAdmin;
  }

  // ==================== CITIZEN (WARGA) ACTIONS ====================

  /**
   * POST /submissions - Create a new submission
   */
  async createSubmission(req, res, next) {
    try {
      const userId = req.user.userId;
      const letterType = req.body.letter_type;
      const schema = loadSubmissionSchema(letterType);

      if (!schema) {
        return res.status(400).json({
          success: false,
          message: `Unknown letter type: '${letterType || ''}'`,
        });
      }

      const validation = validateSubmission(req.body, req.files, schema);
      if (!validation.valid) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: validation.errors,
        });
      }

      const formData = {};
      for (const field of schema.fields || []) {
        if (Object.prototype.hasOwnProperty.call(req.body, field.name)) {
          formData[field.name] = req.body[field.name];
        }
      }

      const files = {};
      for (const [fieldName, uploaded] of Object.entries(req.files || {})) {
        const firstFile = Array.isArray(uploaded) ? uploaded[0] : null;
        if (firstFile?.path) {
          files[fieldName] = firstFile.path;
        }
      }

      const submission = await submissionService.createSubmission({
        userId,
        letterType,
        formData,
        files,
      });

      res.status(201).json({
        success: true,
        data: {
          id: submission.id.toString(),
          letterType: submission.type,
          status: submission.status,
          submittedAt: submission.createdAt,
        },
      });
    } catch (error) {
      if (error.code === 'NOT_FOUND') {
        return res.status(404).json({
          error: 'Not Found',
          message: error.message,
        });
      }
      if (error.code === 'FORBIDDEN') {
        return res.status(403).json({
          error: 'Forbidden',
          message: error.message,
        });
      }
      if (error.code === 'BAD_REQUEST') {
        return res.status(400).json({
          error: 'Bad Request',
          message: error.message,
        });
      }
      next(error);
    }
  }

  /**
   * GET /submissions - Get submissions for current user
   */
  async getMySubmissions(req, res, next) {
    try {
      const userId = req.user.userId;
      const { page, limit, diproses, selesai } = req.query;

      const { submissions, pagination } = await submissionService.getSubmissionsByUser({
        userId,
        page,
        limit,
        diproses,
        selesai,
      });

      res.json({
        data: submissions.map(formatSubmissionByUserResponse),
        pagination,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /submissions/user/:id - Get submission detail by ID for current user
   */
  async getSubmissionUserDetailById(req, res, next) {
    try {
      const { id } = req.params;
      const userId = req.user.userId;

      const submission = await submissionService.getSubmissionUserDetailById({
        submissionId: id,
        userId,
      });

      res.json(this.formatSubmissionDetail(submission, req));
    } catch (error) {
      if (error.code === 'NOT_FOUND') {
        return res.status(404).json({
          error: 'Not Found',
          message: error.message,
        });
      }
      next(error);
    }
  }

  /**
   * GET /submissions/:id - Get submission by ID
   */
  async getSubmissionById(req, res, next) {
    try {
      const { id } = req.params;
      const userId = req.user.userId;
      const userRole = req.user.role;

      const submission = await submissionService.getSubmissionById(id);

      if (!this.canAccessSubmission(submission, userId, userRole)) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Anda tidak memiliki akses ke submission ini',
        });
      }

      res.json(this.formatSubmissionDetail(submission, req));
    } catch (error) {
      if (error.code === 'NOT_FOUND') {
        return res.status(404).json({
          error: 'Not Found',
          message: error.message,
        });
      }
      next(error);
    }
  }

  /**
   * DELETE /submissions/:id - Delete submission (owner only)
   */
  async deleteSubmission(req, res, next) {
    try {
      const { id } = req.params;
      const userId = req.user.userId;

      await submissionService.deleteSubmission({
        submissionId: id,
        userId,
      });

      res.json({
        message: 'Submission berhasil dihapus',
      });
    } catch (error) {
      if (error.code === 'NOT_FOUND') {
        return res.status(404).json({
          error: 'Not Found',
          message: error.message,
        });
      }
      if (error.code === 'FORBIDDEN') {
        return res.status(403).json({
          error: 'Forbidden',
          message: error.message,
        });
      }
      if (error.code === 'BAD_REQUEST') {
        return res.status(400).json({
          error: 'Bad Request',
          message: error.message,
        });
      }
      next(error);
    }
  }

  // ==================== KEPLING ACTIONS ====================

  /**
   * GET /submissions/kepling - Get submissions for kepling's lingkungan
   */
  async getSubmissionsForKepling(req, res, next) {
    try {
      const keplingUserId = req.user.userId;
      const { page, limit, diproses, selesai } = req.query;

      const { submissions, pagination } = await submissionService.getSubmissionsForKepling({
        keplingUserId,
        page,
        limit,
        diproses,
        selesai,
      });

      res.json({
        data: submissions.map(formatSubmissionByUserResponse),
        pagination,
      });
    } catch (error) {
      if (error.code === 'FORBIDDEN') {
        return res.status(403).json({
          error: 'Forbidden',
          message: error.message,
        });
      }
      next(error);
    }
  }

  /**
   * GET /submissions/kepling/:id - Get submission detail by ID for kepling
   */
  async getSubmissionKeplingDetailById(req, res, next) {
    try {
      const { id } = req.params;
      const keplingUserId = req.user.userId;

      const submission = await submissionService.getSubmissionKeplingDetailById({
        submissionId: id,
        keplingUserId,
      });

      res.json(this.formatSubmissionDetail(submission, req));
    } catch (error) {
      if (error.code === 'NOT_FOUND') {
        return res.status(404).json({
          error: 'Not Found',
          message: error.message,
        });
      }
      if (error.code === 'FORBIDDEN') {
        return res.status(403).json({
          error: 'Forbidden',
          message: error.message,
        });
      }
      next(error);
    }
  }

  /**
   * POST /submissions/:id/kepling/approve - Approve by kepling
   */
  async approveByKepling(req, res, next) {
    try {
      const { id } = req.params;
      const keplingUserId = req.user.userId;
      const { note } = req.body;

      const submission = await submissionService.approveByKepling({
        submissionId: id,
        keplingUserId,
        note,
      });

      res.json({
        message: 'Submission berhasil disetujui oleh Kepling',
        data: this.formatSubmissionDetail(submission, req),
      });
    } catch (error) {
      if (error.code === 'NOT_FOUND') {
        return res.status(404).json({
          error: 'Not Found',
          message: error.message,
        });
      }
      if (error.code === 'FORBIDDEN') {
        return res.status(403).json({
          error: 'Forbidden',
          message: error.message,
        });
      }
      if (error.code === 'BAD_REQUEST') {
        return res.status(400).json({
          error: 'Bad Request',
          message: error.message,
        });
      }
      next(error);
    }
  }

  /**
   * POST /submissions/:id/kepling/reject - Reject by kepling
   */
  async rejectByKepling(req, res, next) {
    try {
      const { id } = req.params;
      const keplingUserId = req.user.userId;
      const { reason, note } = req.body;

      const submission = await submissionService.rejectByKepling({
        submissionId: id,
        keplingUserId,
        reason,
        note,
      });

      res.json({
        message: 'Submission ditolak oleh Kepling',
        data: this.formatSubmissionDetail(submission, req),
      });
    } catch (error) {
      if (error.code === 'NOT_FOUND') {
        return res.status(404).json({
          error: 'Not Found',
          message: error.message,
        });
      }
      if (error.code === 'FORBIDDEN') {
        return res.status(403).json({
          error: 'Forbidden',
          message: error.message,
        });
      }
      if (error.code === 'BAD_REQUEST') {
        return res.status(400).json({
          error: 'Bad Request',
          message: error.message,
        });
      }
      next(error);
    }
  }

  // ==================== LURAH ACTIONS ====================

  /**
   * GET /submissions/lurah - Get all submissions for lurah
   */
  async getSubmissionsForLurah(req, res, next) {
    try {
      const { page, limit, diproses, selesai } = req.query;

      const { submissions, pagination } = await submissionService.getSubmissionsForLurah({
        page,
        limit,
        diproses,
        selesai,
      });

      res.json({
        data: submissions.map(formatSubmissionByUserResponse),
        pagination,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /submissions/lurah/:id - Get submission detail by ID for lurah
   */
  async getSubmissionLurahDetailById(req, res, next) {
    try {
      const { id } = req.params;

      const submission = await submissionService.getSubmissionLurahDetailById({
        submissionId: id,
      });

      res.json(this.formatSubmissionDetail(submission, req));
    } catch (error) {
      if (error.code === 'NOT_FOUND') {
        return res.status(404).json({
          error: 'Not Found',
          message: error.message,
        });
      }
      next(error);
    }
  }

  // ==================== ADMIN ACTIONS ====================

  /**
   * GET /submissions/admin/list - Get all submissions for admin monitoring
   */
  async getSubmissionsForAdmin(req, res, next) {
    try {
      const { page, limit, type, status, lingkungan, lingkungan_id, created_at, search, name } = req.query;

      const { submissions, pagination } = await submissionService.getSubmissionsForAdmin({
        page,
        limit,
        type,
        status,
        lingkungan: lingkungan || lingkungan_id,
        createdAt: created_at,
        search: search || name,
      });

      res.json({
        data: submissions.map(formatSubmissionByUserResponse),
        pagination,
      });
    } catch (error) {
      if (error.code === 'BAD_REQUEST') {
        return res.status(400).json({
          error: 'Bad Request',
          message: error.message,
        });
      }
      next(error);
    }
  }

  /**
   * GET /submissions/admin/:id - Get submission detail by ID for admin monitoring
   */
  async getSubmissionAdminDetailById(req, res, next) {
    try {
      const { id } = req.params;

      const submission = await submissionService.getSubmissionAdminDetailById({
        submissionId: id,
      });

      res.json(this.formatSubmissionDetail(submission, req));
    } catch (error) {
      if (error.code === 'NOT_FOUND') {
        return res.status(404).json({
          error: 'Not Found',
          message: error.message,
        });
      }
      next(error);
    }
  }

  /**
   * POST /submissions/:id/lurah/approve - Approve by lurah (triggers letter generation)
   * Body: { passphrase, note?, keterangan? }
   */
  async approveByLurah(req, res, next) {
    try {
      const { id } = req.params;
      const lurahUserId = req.user.userId;
      const { passphrase, note, keterangan } = req.body;

      // Passphrase is required to decrypt the Lurah's signing key
      if (!passphrase) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Passphrase wajib diisi untuk menandatangani surat',
        });
      }

      const { submission, letterResult } = await submissionService.approveByLurah({
        submissionId: id,
        lurahUserId,
        passphrase,
        note,
        keterangan,
      });

      res.json({
        message: 'Submission berhasil disetujui dan surat telah diterbitkan',
        data: {
          submission: this.formatSubmissionDetail(submission, req),
          letter: {
            letter_number: letterResult.letterNumber,
            verification_code: letterResult.verificationCode,
            verification_url: letterResult.verificationUrl,
            pdf_path: letterResult.pdfPath,
            expires_at: letterResult.expiresAt,
          },
        },
      });
    } catch (error) {
      if (error.code === 'NOT_FOUND') {
        return res.status(404).json({
          error: 'Not Found',
          message: error.message,
        });
      }
      if (error.code === 'FORBIDDEN') {
        return res.status(403).json({
          error: 'Forbidden',
          message: error.message,
        });
      }
      if (error.code === 'BAD_REQUEST') {
        return res.status(400).json({
          error: 'Bad Request',
          message: error.message,
        });
      }
      if (error.code === 'CONFLICT') {
        return res.status(409).json({
          error: 'Conflict',
          message: error.message,
        });
      }
      // Handle crypto errors
      if (error.message && error.message.includes('decrypt')) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Passphrase tidak valid',
        });
      }
      next(error);
    }
  }

  /**
   * POST /submissions/:id/lurah/reject - Reject by lurah
   */
  async rejectByLurah(req, res, next) {
    try {
      const { id } = req.params;
      const lurahUserId = req.user.userId;
      const { reason, note } = req.body;

      const submission = await submissionService.rejectByLurah({
        submissionId: id,
        lurahUserId,
        reason,
        note,
      });

      res.json({
        message: 'Submission ditolak oleh Lurah',
        data: this.formatSubmissionDetail(submission, req),
      });
    } catch (error) {
      if (error.code === 'NOT_FOUND') {
        return res.status(404).json({
          error: 'Not Found',
          message: error.message,
        });
      }
      if (error.code === 'FORBIDDEN') {
        return res.status(403).json({
          error: 'Forbidden',
          message: error.message,
        });
      }
      if (error.code === 'BAD_REQUEST') {
        return res.status(400).json({
          error: 'Bad Request',
          message: error.message,
        });
      }
      next(error);
    }
  }

  /**
   * GET /submissions/:id/documents/:documentId - View or download a submission document
   */
  async getSubmissionDocument(req, res, next) {
    try {
      const { id, documentId } = req.params;
      const userId = req.user.userId;
      const userRole = req.user.role;

      const submission = await submissionService.getSubmissionById(id);

      if (!this.canAccessSubmission(submission, userId, userRole)) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Anda tidak memiliki akses ke dokumen ini',
        });
      }

      const document = submission.documents?.find((entry) => entry.id.toString() === documentId.toString());
      if (!document) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'Dokumen tidak ditemukan',
        });
      }

      const absolutePath = this.resolveDocumentPath(document.filePath);
      if (!existsSync(absolutePath)) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'File dokumen tidak ditemukan',
        });
      }

      const inline = !this.isDownloadRequest(req);
      const filename = basename(absolutePath);

      res.setHeader('Content-Type', this.getDocumentMimeType(absolutePath));
      res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${filename}"`);

      createReadStream(absolutePath).pipe(res);
    } catch (error) {
      if (error.code === 'NOT_FOUND') {
        return res.status(404).json({
          error: 'Not Found',
          message: error.message,
        });
      }
      if (error.code === 'FORBIDDEN') {
        return res.status(403).json({
          error: 'Forbidden',
          message: error.message,
        });
      }
      next(error);
    }
  }
}

export default new SubmissionController();
