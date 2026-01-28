import cryptoService from '../services/crypto.service.js';
import prisma from '../config/prisma.js';

/**
 * Key Controller - Handles key management endpoints
 */
class KeyController {
  /**
   * GET /keys/public/:verificationCode - Get public key for a letter (PUBLIC)
   * Used for external signature verification
   */
  async getPublicKeyByLetter(req, res, next) {
    try {
      const { verificationCode } = req.params;

      // Find the letter
      const letter = await prisma.issuedLetter.findUnique({
        where: { verificationCode },
      });

      if (!letter) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'Surat tidak ditemukan',
        });
      }

      // Get the key used to sign this letter
      const keyRecord = await prisma.lurahKey.findFirst({
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
          error: 'Not Found',
          message: 'Kunci publik tidak ditemukan',
        });
      }

      res.json({
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

  /**
   * GET /keys/public/current - Get current active Lurah's public key (PUBLIC)
   */
  async getCurrentPublicKey(req, res, next) {
    try {
      const result = await cryptoService.getActiveLurahKey();

      res.json({
        data: {
          public_key: result.keyRecord.publicKey,
          algorithm: result.keyRecord.algorithm,
          signer: {
            nama: result.lurahProfile.namaLengkap,
            nip: result.lurahProfile.nip,
            jabatan: result.lurahProfile.jabatan,
          },
          created_at: result.keyRecord.createdAt,
        },
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

  /**
   * POST /keys/generate - Generate key pair for logged-in Lurah
   * Only Lurah can generate their own keys
   */
  async generateKey(req, res, next) {
    try {
      const lurahUserId = req.user.userId; // Get from JWT token
      const { passphrase } = req.body;

      if (!passphrase) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Passphrase wajib diisi',
        });
      }

      if (passphrase.length < 8) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Passphrase minimal 8 karakter',
        });
      }

      const result = await cryptoService.setLurahKeyPair(lurahUserId, passphrase);

      res.status(201).json({
        message: 'Key pair berhasil dibuat',
        data: {
          algorithm: result.algorithm,
          key_size: 2048,
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

  /**
   * GET /keys/status - Check if Lurah has active key
   */
  async getKeyStatus(req, res, next) {
    try {
      const lurahUserId = req.user.userId;

      const keyRecord = await cryptoService.getLurahKeyByUserId(lurahUserId);

      res.json({
        has_active_key: !!keyRecord,
        data: keyRecord
          ? {
              algorithm: keyRecord.algorithm,
              created_at: keyRecord.createdAt,
              is_active: keyRecord.isActive,
            }
          : null,
      });
    } catch (error) {
      if (error.code === 'NOT_FOUND') {
        return res.json({
          has_active_key: false,
          data: null,
        });
      }
      next(error);
    }
  }

  /**
   * POST /keys/revoke - Revoke current active key
   */
  async revokeKey(req, res, next) {
    try {
      const lurahUserId = req.user.userId;

      await cryptoService.revokeLurahKey(lurahUserId);

      res.json({
        message: 'Key berhasil dinonaktifkan',
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
}

export default new KeyController();
