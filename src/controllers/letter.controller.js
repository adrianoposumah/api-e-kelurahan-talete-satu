import letterService from '../services/letter.service.js';
import cryptoService from '../services/crypto.service.js';
import templateService from '../services/template.service.js';
import { createReadStream, existsSync } from 'fs';
import { formatIssuedLetterResponse } from '../utils/formatters.js';

/**
 * Letter Controller - Handles letter issuance and verification
 */
class LetterController {
  // ==================== TEMPLATE INFO ====================

  /**
   * GET /letters/templates - Get available letter templates
   */
  async getTemplates(req, res, next) {
    try {
      const types = templateService.getAvailableTypes();
      const templates = await Promise.all(
        types.map(async (type) => {
          const schema = await templateService.getSchema(type);
          return {
            type,
            name: schema.name,
            description: schema.description,
            required_fields: schema.requiredFields,
            validity_days: schema.validityDays,
          };
        }),
      );

      res.json({
        data: templates,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /letters/templates/:type - Get specific template schema
   */
  async getTemplateSchema(req, res, next) {
    try {
      const { type } = req.params;
      const schema = await templateService.getSchema(type);

      res.json({
        type,
        name: schema.name,
        description: schema.description,
        required_fields: schema.requiredFields,
        auto_populated_fields: schema.autoPopulatedFields,
        validity_days: schema.validityDays,
      });
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

  // ==================== KEY MANAGEMENT (ADMIN) ====================

  /**
   * POST /letters/keys/generate - Generate key pair for Lurah
   */
  async generateLurahKey(req, res, next) {
    try {
      const { lurah_user_id, passphrase } = req.body;

      if (!lurah_user_id || !passphrase) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'lurah_user_id dan passphrase wajib diisi',
        });
      }

      if (passphrase.length < 8) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Passphrase minimal 8 karakter',
        });
      }

      const result = await cryptoService.setLurahKeyPair(lurah_user_id, passphrase);

      res.status(201).json({
        message: 'Key pair berhasil dibuat',
        data: {
          id: result.id,
          algorithm: result.algorithm,
          public_key: result.publicKey,
          created_at: result.createdAt,
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
      next(error);
    }
  }

  // ==================== LETTER ISSUANCE (ADMIN) ====================

  /**
   * POST /letters/issue/:submissionId - Issue a letter for submission
   * Body: { passphrase, nomor_surat, keterangan }
   * Letter number format: {nomor_surat}/2009/D.15/I/{tahun}
   */
  async issueLetter(req, res, next) {
    try {
      const { submissionId } = req.params;
      const { passphrase, nomor_surat, keterangan } = req.body;

      // Validate required fields
      if (!passphrase) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Passphrase wajib diisi untuk menandatangani surat',
        });
      }

      if (!nomor_surat) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Nomor surat wajib diisi',
        });
      }

      const result = await letterService.issueLetter({
        submissionId,
        passphrase,
        nomorSurat: nomor_surat,
        keterangan,
      });

      res.status(201).json({
        message: 'Surat berhasil diterbitkan',
        data: {
          letter_number: result.letterNumber,
          verification_code: result.verificationCode,
          verification_url: result.verificationUrl,
          pdf_path: result.pdfPath,
          keterangan: result.issuedLetter.keterangan,
          expires_at: result.expiresAt,
          issued_at: result.issuedLetter.issuedAt,
        },
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

  // ==================== PUBLIC VERIFICATION ====================

  /**
   * GET /letters/verify/:code - Verify letter authenticity (PUBLIC)
   */
  async verifyLetter(req, res, next) {
    try {
      const { code } = req.params;

      const result = await letterService.verifyLetter(code);

      if (result.valid) {
        res.json({
          status: 'valid',
          message: result.message,
          data: {
            letter: result.letter,
            issued_at: result.issuedAt,
            expires_at: result.expiresAt,
          },
        });
      } else {
        res.json({
          status: 'invalid',
          reason: result.reason,
          data: result.letter
            ? {
                letter: result.letter,
                revoked_at: result.revokedAt,
                expired_at: result.expiredAt,
              }
            : null,
        });
      }
    } catch (error) {
      if (error.code === 'NOT_FOUND') {
        return res.status(404).json({
          status: 'not_found',
          message: 'Surat dengan kode verifikasi tersebut tidak ditemukan',
        });
      }
      next(error);
    }
  }

  // ==================== LETTER ACCESS ====================

  /**
   * GET /letters - Get user's letters
   */
  async getMyLetters(req, res, next) {
    try {
      const userId = req.user.userId;
      const { page, limit } = req.query;

      const { letters, pagination } = await letterService.getLettersByUser({
        userId,
        page,
        limit,
      });

      res.json({
        data: letters.map(formatIssuedLetterResponse),
        pagination,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /letters/all - Get all letters (admin)
   */
  async getAllLetters(req, res, next) {
    try {
      const { page, limit, type } = req.query;

      const { letters, pagination } = await letterService.getAllLetters({
        page,
        limit,
        type,
      });

      res.json({
        data: letters.map(formatIssuedLetterResponse),
        pagination,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /letters/download/:code - Download letter PDF
   */
  async downloadLetter(req, res, next) {
    try {
      const { code } = req.params;
      const userId = req.user.userId;
      const userRole = req.user.role;

      const pdfPath = await letterService.getLetterPdfPath(code, userId, userRole);

      if (!existsSync(pdfPath)) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'File PDF tidak ditemukan',
        });
      }

      // Set headers for PDF download
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="surat_${code}.pdf"`);

      // Stream the file
      const stream = createReadStream(pdfPath);
      stream.pipe(res);
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
   * GET /letters/:code - Get letter details
   */
  async getLetterByCode(req, res, next) {
    try {
      const { code } = req.params;
      const userId = req.user.userId;
      const userRole = req.user.role;

      const letter = await letterService.getLetterByVerificationCode(code);

      // Check access
      const isOwner = letter.submission.userId.toString() === userId.toString();
      const isAdmin = userRole === 'admin';
      const isLurah = userRole === 'lurah';
      const isSekertaris = userRole === 'sekertaris';

      if (!isOwner && !isAdmin && !isLurah && !isSekertaris) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Anda tidak memiliki akses ke surat ini',
        });
      }

      res.json(formatIssuedLetterResponse(letter));
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

  // ==================== LETTER REVOCATION (ADMIN) ====================

  /**
   * POST /letters/:code/revoke - Revoke a letter
   */
  async revokeLetter(req, res, next) {
    try {
      const { code } = req.params;
      const { reason } = req.body;

      if (!reason) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Alasan pencabutan wajib diisi',
        });
      }

      const letter = await letterService.revokeLetter({
        verificationCode: code,
        reason,
      });

      res.json({
        message: 'Surat berhasil dicabut',
        data: formatIssuedLetterResponse(letter),
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

export default new LetterController();
