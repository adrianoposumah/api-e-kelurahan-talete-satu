import cryptoService from '../services/crypto.service.js';
import enrollmentService from '../services/enrollment.service.js';
import caService from '../services/ca.service.js';

/**
 * Key Controller - Handles key management endpoints
 */
class KeyController {
  /**
   * POST /keys/generate - Generate key pair for logged-in Lurah
   * Only Lurah can generate their own keys
   */
  async generateKey(req, res, _next) {
    return res.status(410).json({
      error: 'Gone',
      message: 'Endpoint ini sudah tidak didukung. Gunakan /v1/keys/enrollment-token dan /v1/keys/csr.',
    });
  }

  /**
   * POST /keys/enrollment-token - Request short-lived CSR enrollment token.
   */
  async requestEnrollmentToken(req, res, next) {
    try {
      const purpose = req.body?.purpose === 'rotation' || req.body?.purpose === 'ROTATION' || req.body?.rotate === true ? 'ROTATION' : 'ENROLLMENT';
      const result = await enrollmentService.issueEnrollmentToken(req.user.userId, {
        allowExistingActiveKey: purpose === 'ROTATION',
        requireExistingActiveKey: purpose === 'ROTATION',
        purpose,
      });
      res.json({
        success: true,
        data: {
          enrollmentToken: result.enrollmentToken,
          expiresAt: result.expiresAt,
          subjectTemplate: result.subjectTemplate,
        },
      });
    } catch (error) {
      if (error.code === 'ALREADY_ENROLLED') {
        return res.status(409).json({
          error: 'Conflict',
          message: error.message,
          data: error.details || null,
        });
      }
      if (error.code === 'NOT_FOUND') {
        return res.status(404).json({ error: 'Not Found', message: error.message });
      }
      if (error.code === 'ENROLLMENT_REQUIRED') {
        return res.status(412).json({ error: 'Precondition Failed', message: error.message });
      }
      next(error);
    }
  }

  /**
   * POST /keys/csr - Submit PKCS#10 CSR and receive Lurah certificate.
   */
  async submitCsr(req, res, next) {
    try {
      const { enrollmentToken, csrPem, deviceLabel } = req.body || {};
      if (!enrollmentToken || !csrPem) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'enrollmentToken dan csrPem wajib diisi',
        });
      }

      const result = await enrollmentService.submitCsr(req.user.userId, {
        enrollmentToken,
        csrPem,
        deviceLabel,
      });

      res.status(201).json({
        success: true,
        message: 'Sertifikat berhasil diterbitkan',
        data: {
          keyId: result.keyId,
          certificatePem: result.certificatePem,
          rootCaCertificatePem: result.rootCaCertificatePem,
          serialNumber: result.serialNumber,
          fingerprint: result.fingerprint,
          algorithm: result.algorithm,
          issuedAt: result.issuedAt,
          expiresAt: result.expiresAt,
        },
      });
    } catch (error) {
      if (error.code === 'ENROLLMENT_TOKEN_EXPIRED') {
        return res.status(410).json({ error: 'Gone', message: error.message });
      }
      if (['INVALID_INPUT', 'INVALID_CSR', 'SUBJECT_MISMATCH'].includes(error.code)) {
        return res.status(400).json({ error: 'Bad Request', message: error.message });
      }
      if (error.code === 'ALREADY_ENROLLED') {
        return res.status(409).json({ error: 'Conflict', message: error.message });
      }
      if (error.code === 'NOT_FOUND') {
        return res.status(404).json({ error: 'Not Found', message: error.message });
      }
      next(error);
    }
  }

  /**
   * GET /keys/certificate - Get current active Lurah certificate.
   */
  async getCertificate(req, res, next) {
    try {
      const keyRecord = await enrollmentService.getCertificate(req.user.userId);
      if (!keyRecord) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'Lurah belum melakukan enrollment',
        });
      }

      res.json({
        success: true,
        data: {
          keyId: keyRecord.id.toString(),
          certificatePem: keyRecord.certificatePem,
          rootCaCertificatePem: caService.getRootCaPem(),
          serialNumber: keyRecord.serialNumber,
          fingerprint: keyRecord.fingerprint,
          deviceLabel: keyRecord.deviceLabel,
          algorithm: keyRecord.algorithm,
          status: keyRecord.status,
          issuedAt: keyRecord.enrolledAt,
          expiresAt: keyRecord.expiresAt,
        },
      });
    } catch (error) {
      if (error.code === 'NOT_FOUND') {
        return res.status(404).json({ error: 'Not Found', message: error.message });
      }
      next(error);
    }
  }

  /**
   * POST /keys/rotate - Rotate active Lurah certificate with a new CSR.
   */
  async rotateKey(req, res, next) {
    try {
      const { enrollmentToken, csrPem, deviceLabel } = req.body || {};
      if (!enrollmentToken || !csrPem) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'enrollmentToken dan csrPem wajib diisi',
        });
      }

      const result = await enrollmentService.rotateCsr(req.user.userId, {
        enrollmentToken,
        csrPem,
        deviceLabel,
      });

      res.status(201).json({
        success: true,
        message: 'Sertifikat berhasil dirotasi',
        data: {
          keyId: result.keyId,
          certificatePem: result.certificatePem,
          rootCaCertificatePem: result.rootCaCertificatePem,
          serialNumber: result.serialNumber,
          fingerprint: result.fingerprint,
          algorithm: result.algorithm,
          issuedAt: result.issuedAt,
          expiresAt: result.expiresAt,
          revokedKeyId: result.revokedKeyId,
          revokedAt: result.revokedAt,
          deactivateReason: 'ROUTINE_ROTATION',
        },
      });
    } catch (error) {
      if (error.code === 'ENROLLMENT_TOKEN_EXPIRED') {
        return res.status(410).json({ error: 'Gone', message: error.message });
      }
      if (['INVALID_INPUT', 'INVALID_CSR', 'SUBJECT_MISMATCH'].includes(error.code)) {
        return res.status(400).json({ error: 'Bad Request', message: error.message });
      }
      if (error.code === 'ENROLLMENT_REQUIRED') {
        return res.status(412).json({ error: 'Precondition Failed', message: error.message });
      }
      if (error.code === 'NOT_FOUND') {
        return res.status(404).json({ error: 'Not Found', message: error.message });
      }
      next(error);
    }
  }

  /**
   * POST /keys/:id/revoke - Revoke a key (Admin only)
   */
  async revokeKey(req, res, next) {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      const adminUserId = req.user.userId;

      if (!reason) {
        return res.status(400).json({
          success: false,
          message: 'Alasan revoke wajib diisi',
        });
      }

      const result = await cryptoService.revokeKey(id, adminUserId, reason);

      res.json({
        success: true,
        message: 'Key berhasil direvoke',
        data: {
          id: result.id,
          status: result.status,
          deactivatedAt: result.deactivatedAt,
          deactivateReason: result.deactivateReason,
        },
      });
    } catch (error) {
      if (error.code === 'NOT_FOUND') {
        return res.status(404).json({
          success: false,
          message: error.message,
        });
      }
      if (error.code === 'BAD_REQUEST') {
        return res.status(400).json({
          success: false,
          message: error.message,
        });
      }
      next(error);
    }
  }

  /**
   * GET /keys - List all keys (Admin only)
   * Only includes public certificate/key material.
   */
  async listKeys(req, res, next) {
    try {
      const keys = await cryptoService.getAllPublicKeys();

      res.json({
        success: true,
        data: keys.map((k) => ({
          id: k.id.toString(),
          publicKey: k.publicKey,
          certificatePem: k.certificatePem || null,
          fingerprint: k.fingerprint || null,
          serialNumber: k.serialNumber || null,
          deviceLabel: k.deviceLabel || null,
          algorithm: k.algorithm,
          status: k.status,
          createdAt: k.createdAt,
          enrolledAt: k.enrolledAt,
          expiresAt: k.expiresAt,
          deactivatedAt: k.deactivatedAt,
          deactivateReason: k.deactivateReason,
          lurahProfile: k.lurahProfile,
        })),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /keys/active - Get current active Lurah's public key (PUBLIC)
   */
  async getCurrentPublicKey(req, res, next) {
    try {
      const result = await cryptoService.getActivePublicKey();

      if (!result) {
        return res.json({
          success: true,
          data: null,
        });
      }

      res.json({
        success: true,
        data: {
          id: result.id.toString(),
          publicKey: result.publicKey,
          certificatePem: result.certificatePem || null,
          rootCaCertificatePem: result.certificatePem ? caService.getRootCaPem() : null,
          algorithm: result.algorithm,
          createdAt: result.createdAt,
          expiresAt: result.expiresAt || null,
          signer: result.lurahProfile
            ? {
                nama: result.lurahProfile.namaLengkap,
                nip: result.lurahProfile.nip,
                jabatan: result.lurahProfile.jabatan,
              }
            : null,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /keys/status - Check if Lurah has active key
   */
  async getKeyStatus(req, res, next) {
    try {
      const lurahUserId = req.user.userId;

      const keyRecord = await cryptoService.getLurahKeyByUserId(lurahUserId);

      res.json({
        success: true,
        has_active_key: !!keyRecord,
        data: keyRecord
          ? {
              algorithm: keyRecord.algorithm,
              status: keyRecord.status,
              certificatePem: keyRecord.certificatePem || null,
              fingerprint: keyRecord.fingerprint || null,
              created_at: keyRecord.createdAt,
              expires_at: keyRecord.expiresAt || null,
            }
          : null,
      });
    } catch (error) {
      if (error.code === 'NOT_FOUND') {
        return res.json({
          success: true,
          has_active_key: false,
          data: null,
        });
      }
      next(error);
    }
  }

  /**
   * GET /keys/public/:verificationCode - Get public key for a letter (PUBLIC)
   */
  async getPublicKeyByLetter(req, res, next) {
    try {
      const { verificationCode } = req.params;
      const prisma = (await import('../config/prisma.js')).default;

      const letter = await prisma.issuedLetter.findUnique({
        where: { verificationCode },
      });

      if (!letter) {
        return res.status(404).json({
          success: false,
          message: 'Surat tidak ditemukan',
        });
      }

      const keyRecord = letter.signatureKeyId
        ? await prisma.lurahKey.findUnique({
            where: { id: letter.signatureKeyId },
            include: {
              lurahProfile: {
                select: {
                  namaLengkap: true,
                  nip: true,
                  jabatan: true,
                },
              },
            },
          })
        : null;

      if (!keyRecord) {
        return res.status(404).json({
          success: false,
          message: 'Kunci publik tidak ditemukan',
        });
      }

      res.json({
        success: true,
        data: {
          public_key: keyRecord.publicKey,
          certificatePem: keyRecord.certificatePem || null,
          rootCaCertificatePem: keyRecord.certificatePem ? caService.getRootCaPem() : null,
          algorithm: keyRecord.algorithm,
          signer: {
            nama: keyRecord.lurahProfile.namaLengkap,
            nip: keyRecord.lurahProfile.nip,
            jabatan: keyRecord.lurahProfile.jabatan,
          },
          letter: {
            letter_number: letter.letterNumber,
            issued_at: letter.issuedAt,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }
}

export default new KeyController();
