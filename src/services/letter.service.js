import { v4 as uuidv4 } from 'uuid';
import prisma from '../config/prisma.js';
import templateService from './template.service.js';
import cryptoService from './crypto.service.js';
import pdfService from './pdf.service.js';
import env from '../config/env.js';

/**
 * Letter Service - Orchestrates the letter issuance workflow
 */
class LetterService {
  /**
   * Generate letter number
   * @param {string} type - Letter type
   * @param {object} schema - Letter schema
   * @returns {Promise<string>} Letter number
   */
  async generateLetterNumber(type, schema) {
    const year = new Date().getFullYear();
    const month = String(new Date().getMonth() + 1).padStart(2, '0');

    // Get count of letters this year for this type
    const count = await prisma.issuedLetter.count({
      where: {
        type,
        createdAt: {
          gte: new Date(`${year}-01-01`),
          lt: new Date(`${year + 1}-01-01`),
        },
      },
    });

    const sequenceNumber = String(count + 1).padStart(4, '0');
    const prefix = schema.letterPrefix || type.toUpperCase().substring(0, 2);

    // Format: {sequence}/{year}/{prefix}/{month}/{year}
    return `${sequenceNumber}/${year}/${prefix}/${this.getRomanMonth(parseInt(month))}/${year}`;
  }

  /**
   * Convert month number to Roman numeral
   * @param {number} month - Month number (1-12)
   * @returns {string} Roman numeral
   */
  getRomanMonth(month) {
    const romans = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
    return romans[month - 1] || 'I';
  }

  /**
   * Get Lurah info for signing
   * @returns {Promise<object>} Lurah info
   */
  async getLurahInfo() {
    const { keyRecord, lurahProfile } = await cryptoService.getActiveLurahKey();

    return {
      keyRecord,
      lurahProfile,
      lurahName: lurahProfile.namaLengkap,
      lurahNip: lurahProfile.nip,
    };
  }

  /**
   * Issue a letter for an approved submission
   * @param {object} params - Issue parameters
   * @returns {Promise<object>} Issued letter
   */
  async issueLetter({ submissionId, passphrase }) {
    // Get submission with all relations
    const submission = await prisma.submission.findUnique({
      where: { id: BigInt(submissionId) },
      include: {
        user: {
          include: { kependudukan: true },
        },
        lingkungan: true,
        documents: true,
        approvals: {
          include: { approver: true },
          orderBy: { createdAt: 'asc' },
        },
        issuedLetter: true,
      },
    });

    if (!submission) {
      const error = new Error('Submission tidak ditemukan');
      error.code = 'NOT_FOUND';
      throw error;
    }

    if (submission.status !== 'approved') {
      const error = new Error('Submission belum disetujui oleh Lurah');
      error.code = 'BAD_REQUEST';
      throw error;
    }

    if (submission.issuedLetter) {
      const error = new Error('Surat sudah pernah diterbitkan');
      error.code = 'CONFLICT';
      throw error;
    }

    if (!submission.user.kependudukan) {
      const error = new Error('Data kependudukan pemohon tidak ditemukan');
      error.code = 'NOT_FOUND';
      throw error;
    }

    // Get template schema
    const schema = await templateService.getSchema(submission.type);

    // Generate letter number
    const letterNumber = await this.generateLetterNumber(submission.type, schema);

    // Generate verification code
    const verificationCode = uuidv4().replace(/-/g, '').substring(0, 16).toUpperCase();

    // Get Lurah info
    const { keyRecord, lurahName, lurahNip } = await this.getLurahInfo();

    // Build verification URL
    const baseUrl = env.APP_URL || 'http://localhost:3000';
    const verificationUrl = `${baseUrl}/v1/letters/verify/${verificationCode}`;

    // Prepare template data
    const templateData = templateService.prepareTemplateData(submission, {
      letterNumber,
      lurahName,
      lurahNip,
      logoUrl: `${baseUrl}/assets/logo-tomohon.png`,
      verificationUrl,
    });

    // Build canonical data for signing
    const canonicalInput = {
      nama: submission.user.kependudukan.nama,
      nik: submission.user.kependudukan.nik,
      jenisKelamin: submission.user.kependudukan.jenisKelamin,
      lingkungan: submission.lingkungan.nama,
      nomorSurat: letterNumber,
      type: submission.type,
      tanggal: new Date().toISOString().split('T')[0],
      issuedBy: lurahName,
    };

    // Create digital signature (using lurahProfile.id)
    const signatureData = await cryptoService.createLetterSignature(canonicalInput, keyRecord.lurahProfileId.toString(), passphrase);

    // Render HTML template
    const html = await templateService.renderTemplate(submission.type, templateData);

    // Generate PDF with QR code
    const pdfResult = await pdfService.generateLetterPdf({
      html,
      verificationCode,
      verificationUrl,
      letterNumber,
      signatureData,
    });

    // Calculate expiry date
    let expiresAt = null;
    if (schema.validityDays) {
      expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + schema.validityDays);
    }

    // Create issued letter record and update submission in transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create issued letter
      const issuedLetter = await tx.issuedLetter.create({
        data: {
          submissionId: BigInt(submissionId),
          letterNumber,
          verificationCode,
          type: submission.type,
          canonicalData: signatureData.canonicalData,
          canonicalHash: signatureData.canonicalHash,
          signature: signatureData.signature,
          signedBy: keyRecord.lurahProfileId, // Store lurahProfile ID
          pdfPath: pdfResult.filePath,
          expiresAt,
        },
      });

      // Update submission status to issued
      await tx.submission.update({
        where: { id: BigInt(submissionId) },
        data: { status: 'issued' },
      });

      return issuedLetter;
    });

    return {
      issuedLetter: result,
      letterNumber,
      verificationCode,
      verificationUrl,
      pdfPath: pdfResult.filePath,
      expiresAt,
    };
  }

  /**
   * Get issued letter by verification code
   * @param {string} verificationCode - Verification code
   * @returns {Promise<object>} Issued letter
   */
  async getLetterByVerificationCode(verificationCode) {
    const letter = await prisma.issuedLetter.findUnique({
      where: { verificationCode },
      include: {
        submission: {
          include: {
            user: {
              include: { kependudukan: true },
            },
            lingkungan: true,
          },
        },
      },
    });

    if (!letter) {
      const error = new Error('Surat tidak ditemukan');
      error.code = 'NOT_FOUND';
      throw error;
    }

    return letter;
  }

  /**
   * Verify letter authenticity
   * @param {string} verificationCode - Verification code
   * @returns {Promise<object>} Verification result
   */
  async verifyLetter(verificationCode) {
    const letter = await this.getLetterByVerificationCode(verificationCode);

    // Get the public key used for signing (signedBy now stores lurahProfileId)
    const keyRecord = await prisma.lurahKey.findFirst({
      where: {
        lurahProfileId: letter.signedBy,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!keyRecord) {
      return {
        valid: false,
        reason: 'Kunci publik penanda tangan tidak ditemukan',
        letter: null,
      };
    }

    // Verify signature
    const isValid = cryptoService.verifyLetterSignature(letter.canonicalData, letter.signature, keyRecord.publicKey);

    // Check revocation
    if (letter.isRevoked) {
      return {
        valid: false,
        reason: `Surat telah dicabut: ${letter.revokedReason || 'Tidak ada alasan'}`,
        revokedAt: letter.revokedAt,
        letter: this.formatLetterForPublic(letter),
      };
    }

    // Check expiry
    if (letter.expiresAt && new Date() > letter.expiresAt) {
      return {
        valid: false,
        reason: 'Surat sudah kadaluarsa',
        expiredAt: letter.expiresAt,
        letter: this.formatLetterForPublic(letter),
      };
    }

    if (!isValid) {
      return {
        valid: false,
        reason: 'Tanda tangan digital tidak valid',
        letter: null,
      };
    }

    return {
      valid: true,
      message: 'Surat ini asli dan masih berlaku',
      letter: this.formatLetterForPublic(letter),
      issuedAt: letter.issuedAt,
      expiresAt: letter.expiresAt,
    };
  }

  /**
   * Format letter for public display (hide sensitive info)
   * @param {object} letter - Issued letter with relations
   * @returns {object} Formatted letter
   */
  formatLetterForPublic(letter) {
    return {
      letterNumber: letter.letterNumber,
      type: letter.type,
      issuedAt: letter.issuedAt,
      expiresAt: letter.expiresAt,
      applicant: {
        nama: letter.submission.user.kependudukan?.nama || '-',
        lingkungan: letter.submission.lingkungan.nama,
      },
    };
  }

  /**
   * Get issued letters for a user
   * @param {object} options - Query options
   * @returns {Promise<object>} Letters and pagination
   */
  async getLettersByUser({ userId, page = 1, limit = 10 }) {
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [letters, total] = await Promise.all([
      prisma.issuedLetter.findMany({
        where: {
          submission: {
            userId: BigInt(userId),
          },
        },
        skip,
        take: parseInt(limit),
        orderBy: { issuedAt: 'desc' },
        include: {
          submission: {
            include: {
              lingkungan: true,
            },
          },
        },
      }),
      prisma.issuedLetter.count({
        where: {
          submission: {
            userId: BigInt(userId),
          },
        },
      }),
    ]);

    return {
      letters,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        total_pages: Math.ceil(total / parseInt(limit)),
      },
    };
  }

  /**
   * Get all issued letters (admin)
   * @param {object} options - Query options
   * @returns {Promise<object>} Letters and pagination
   */
  async getAllLetters({ page = 1, limit = 10, type }) {
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (type) where.type = type;

    const [letters, total] = await Promise.all([
      prisma.issuedLetter.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { issuedAt: 'desc' },
        include: {
          submission: {
            include: {
              user: {
                include: { kependudukan: true },
              },
              lingkungan: true,
            },
          },
        },
      }),
      prisma.issuedLetter.count({ where }),
    ]);

    return {
      letters,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        total_pages: Math.ceil(total / parseInt(limit)),
      },
    };
  }

  /**
   * Revoke an issued letter
   * @param {object} params - Revocation parameters
   * @returns {Promise<object>} Updated letter
   */
  async revokeLetter({ verificationCode, reason }) {
    const letter = await this.getLetterByVerificationCode(verificationCode);

    if (letter.isRevoked) {
      const error = new Error('Surat sudah dicabut sebelumnya');
      error.code = 'BAD_REQUEST';
      throw error;
    }

    const updatedLetter = await prisma.issuedLetter.update({
      where: { id: letter.id },
      data: {
        isRevoked: true,
        revokedAt: new Date(),
        revokedReason: reason,
      },
      include: {
        submission: {
          include: {
            user: {
              include: { kependudukan: true },
            },
            lingkungan: true,
          },
        },
      },
    });

    return updatedLetter;
  }

  /**
   * Get PDF file path for a letter
   * @param {string} verificationCode - Verification code
   * @param {string} userId - User ID (for access control)
   * @param {string} userRole - User role
   * @returns {Promise<string>} PDF file path
   */
  async getLetterPdfPath(verificationCode, userId, userRole) {
    const letter = await this.getLetterByVerificationCode(verificationCode);

    // Check access
    const isOwner = letter.submission.userId.toString() === userId.toString();
    const isAdmin = userRole === 'admin';
    const isLurah = userRole === 'lurah';

    if (!isOwner && !isAdmin && !isLurah) {
      const error = new Error('Anda tidak memiliki akses ke surat ini');
      error.code = 'FORBIDDEN';
      throw error;
    }

    return letter.pdfPath;
  }
}

export default new LetterService();
