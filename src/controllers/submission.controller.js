import submissionService from '../services/submission.service.js';
import { formatSubmissionResponse, formatSubmissionDocumentResponse } from '../utils/formatters.js';

/**
 * Submission Controller - Handles submission request/response
 */
class SubmissionController {
  // ==================== CITIZEN (WARGA) ACTIONS ====================

  /**
   * POST /submissions - Create a new submission
   */
  async createSubmission(req, res, next) {
    try {
      const userId = req.user.id;
      const { type, payload } = req.body;

      if (!type) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Tipe submission wajib diisi',
        });
      }

      const validTypes = ['domisili', 'usaha', 'kematian', 'kelakuan_baik', 'keramaian'];
      if (!validTypes.includes(type)) {
        return res.status(400).json({
          error: 'Bad Request',
          message: `Tipe submission tidak valid. Pilihan: ${validTypes.join(', ')}`,
        });
      }

      const submission = await submissionService.createSubmission({
        userId,
        type,
        payload,
      });

      res.status(201).json({
        message: 'Submission berhasil dibuat',
        data: formatSubmissionResponse(submission),
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
   * POST /submissions/:id/documents - Add document to submission
   */
  async addDocument(req, res, next) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const { file_path, file_type, description } = req.body;

      if (!file_path) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Path file wajib diisi',
        });
      }

      const document = await submissionService.addDocument({
        submissionId: id,
        userId,
        filePath: file_path,
        fileType: file_type,
        description,
      });

      res.status(201).json({
        message: 'Dokumen berhasil ditambahkan',
        data: formatSubmissionDocumentResponse(document),
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
      const userId = req.user.id;
      const { page, limit, status, type } = req.query;

      const { submissions, pagination } = await submissionService.getSubmissionsByUser({
        userId,
        page,
        limit,
        status,
        type,
      });

      res.json({
        data: submissions.map(formatSubmissionResponse),
        pagination,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /submissions/:id - Get submission by ID
   */
  async getSubmissionById(req, res, next) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const userRole = req.user.role;

      const submission = await submissionService.getSubmissionById(id);

      // Access control
      const isOwner = submission.userId.toString() === userId.toString();
      const isKepling = userRole === 'kepling';
      const isLurah = userRole === 'lurah';
      const isAdmin = userRole === 'admin';

      // Kepling can only view submissions from their lingkungan
      if (isKepling && !isOwner) {
        // Check if kepling is assigned to this lingkungan
        const hasAccess = submission.lingkungan.keplings?.some((k) => k.userId.toString() === userId.toString());
        if (!hasAccess) {
          return res.status(403).json({
            error: 'Forbidden',
            message: 'Anda tidak memiliki akses ke submission ini',
          });
        }
      }

      // Warga can only view their own submissions
      if (userRole === 'warga' && !isOwner) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Anda tidak memiliki akses ke submission ini',
        });
      }

      // Lurah and Admin can view all
      if (!isOwner && !isKepling && !isLurah && !isAdmin) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Anda tidak memiliki akses ke submission ini',
        });
      }

      res.json(formatSubmissionResponse(submission));
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
      const userId = req.user.id;

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
      const keplingUserId = req.user.id;
      const { page, limit, status, type } = req.query;

      const { submissions, pagination } = await submissionService.getSubmissionsForKepling({
        keplingUserId,
        page,
        limit,
        status,
        type,
      });

      res.json({
        data: submissions.map(formatSubmissionResponse),
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
   * PATCH /submissions/:id/documents/:documentId/verify - Verify document
   */
  async verifyDocument(req, res, next) {
    try {
      const { documentId } = req.params;
      const keplingUserId = req.user.id;
      const { verified } = req.body;

      if (typeof verified !== 'boolean') {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Status verified wajib diisi (boolean)',
        });
      }

      const document = await submissionService.verifyDocument({
        documentId,
        keplingUserId,
        verified,
      });

      res.json({
        message: `Dokumen berhasil ${verified ? 'diverifikasi' : 'dibatalkan verifikasinya'}`,
        data: formatSubmissionDocumentResponse(document),
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
      next(error);
    }
  }

  /**
   * POST /submissions/:id/kepling/approve - Approve by kepling
   */
  async approveByKepling(req, res, next) {
    try {
      const { id } = req.params;
      const keplingUserId = req.user.id;
      const { note } = req.body;

      const submission = await submissionService.approveByKepling({
        submissionId: id,
        keplingUserId,
        note,
      });

      res.json({
        message: 'Submission berhasil disetujui oleh Kepling',
        data: formatSubmissionResponse(submission),
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
      const keplingUserId = req.user.id;
      const { reason, note } = req.body;

      const submission = await submissionService.rejectByKepling({
        submissionId: id,
        keplingUserId,
        reason,
        note,
      });

      res.json({
        message: 'Submission ditolak oleh Kepling',
        data: formatSubmissionResponse(submission),
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
      const { page, limit, status, type } = req.query;

      const { submissions, pagination } = await submissionService.getSubmissionsForLurah({
        page,
        limit,
        status,
        type,
      });

      res.json({
        data: submissions.map(formatSubmissionResponse),
        pagination,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /submissions/:id/lurah/approve - Approve by lurah
   */
  async approveByLurah(req, res, next) {
    try {
      const { id } = req.params;
      const lurahUserId = req.user.id;
      const { note } = req.body;

      const submission = await submissionService.approveByLurah({
        submissionId: id,
        lurahUserId,
        note,
      });

      res.json({
        message: 'Submission berhasil disetujui oleh Lurah',
        data: formatSubmissionResponse(submission),
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
   * POST /submissions/:id/lurah/reject - Reject by lurah
   */
  async rejectByLurah(req, res, next) {
    try {
      const { id } = req.params;
      const lurahUserId = req.user.id;
      const { reason, note } = req.body;

      const submission = await submissionService.rejectByLurah({
        submissionId: id,
        lurahUserId,
        reason,
        note,
      });

      res.json({
        message: 'Submission ditolak oleh Lurah',
        data: formatSubmissionResponse(submission),
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

  // ==================== ADMIN ACTIONS ====================

  /**
   * POST /submissions/:id/issue - Issue submission (admin only)
   */
  async issueSubmission(req, res, next) {
    try {
      const { id } = req.params;

      const submission = await submissionService.issueSubmission({
        submissionId: id,
      });

      res.json({
        message: 'Surat berhasil diterbitkan',
        data: formatSubmissionResponse(submission),
      });
    } catch (error) {
      if (error.code === 'NOT_FOUND') {
        return res.status(404).json({
          error: 'Not Found',
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
}

export default new SubmissionController();
