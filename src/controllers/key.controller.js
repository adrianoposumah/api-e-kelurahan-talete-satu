import cryptoService from '../services/crypto.service.js';

/**
 * Key Controller - Handles key management endpoints
 */
class KeyController {
  /**
   * POST /keys/generate - Generate key pair for logged-in Lurah
   * Only Lurah can generate their own keys
   */
  async generateKey(req, res, next) {
    try {
      const lurahUserId = req.user.userId;
      const { passphrase } = req.body;

      if (!passphrase) {
        return res.status(400).json({
          success: false,
          message: 'Passphrase wajib diisi',
        });
      }

      if (passphrase.length < 8) {
        return res.status(400).json({
          success: false,
          message: 'Passphrase minimal 8 karakter',
        });
      }

      const result = await cryptoService.generateLurahKey(lurahUserId, passphrase);

      res.status(201).json({
        success: true,
        message: 'Key pair berhasil dibuat',
        data: {
          id: result.id,
          publicKey: result.publicKey,
          status: result.status,
          createdAt: result.createdAt,
        },
      });
    } catch (error) {
      if (error.code === 'NOT_FOUND') {
        return res.status(404).json({
          success: false,
          message: error.message,
        });
      }
      if (error.code === 'FORBIDDEN') {
        return res.status(403).json({
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
   * Never includes encryptedPrivateKey
   */
  async listKeys(req, res, next) {
    try {
      const keys = await cryptoService.getAllPublicKeys();

      res.json({
        success: true,
        data: keys.map((k) => ({
          id: k.id.toString(),
          publicKey: k.publicKey,
          algorithm: k.algorithm,
          status: k.status,
          createdAt: k.createdAt,
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
          algorithm: result.algorithm,
          createdAt: result.createdAt,
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
              created_at: keyRecord.createdAt,
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

      // Prefer signatureKeyId (exact key used) over signedBy (lurahProfileId)
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
        : await prisma.lurahKey.findFirst({
            where: { lurahProfileId: letter.signedBy },
            include: {
              lurahProfile: {
                select: {
                  namaLengkap: true,
                  nip: true,
                  jabatan: true,
                },
              },
            },
            orderBy: { createdAt: 'desc' },
          });

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
          algorithm: keyRecord.algorithm,
          signer: {
            nama: keyRecord.lurahProfile.namaLengkap,
            nip: keyRecord.lurahProfile.nip,
            jabatan: keyRecord.lurahProfile.jabatan,
          },
          letter: {
            letter_number: letter.letterNumber,
            canonical_hash: letter.canonicalHash,
            signature: letter.signature,
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
