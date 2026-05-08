import { randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../config/prisma.js';
import templateService from './template.service.js';
import cryptoService from './crypto.service.js';
import pdfService from './pdf.service.js';
import env from '../config/env.js';

const parseBigIntFilter = (value, fieldName) => {
  try {
    return BigInt(value);
  } catch {
    const error = new Error(`${fieldName} harus berupa angka yang valid`);
    error.code = 'BAD_REQUEST';
    throw error;
  }
};

/**
 * Letter Service - Letter number, QR, PDF generation, signing
 *
 * Orchestrates the 7-phase letter issuance pipeline triggered
 * when the Lurah approves a submission.
 */
class LetterService {
  /**
   * Generate an 8-character random verification prefix.
   * @returns {string} Uppercase random code
   */
  generateVerificationPrefix() {
    return randomBytes(4).toString('hex').toUpperCase();
  }

  /**
   * Generate letter identity using atomic LetterCounter.
   * Verification code format: {random_8_chars}-{sequence}
   * Letter number format: {verificationCode}/2009/D.15/{roman_month}/{year}
   * @param {string} type - Letter type
   * @returns {Promise<{ verificationCode: string, letterNumber: string }>} Letter identity
   */
  async generateLetterIdentity(type) {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    // Atomic increment via SQL upsert — avoids stale Prisma client model access issues.
    const rows = await prisma.$queryRaw`
      INSERT INTO letter_counters (letter_type, year, sequence)
      VALUES (${type}, ${year}, 1)
      ON CONFLICT (letter_type, year)
      DO UPDATE SET sequence = letter_counters.sequence + 1
      RETURNING sequence
    `;

    const sequence = Number(rows?.[0]?.sequence || 1);
    const seq = String(sequence).padStart(3, '0');
    const verificationCode = `${this.generateVerificationPrefix()}-${seq}`;
    const letterNumber = `${verificationCode}/2009/D.15/${this.getRomanMonth(month)}/${year}`;

    return { verificationCode, letterNumber };
  }

  /**
   * Generate letter number using atomic LetterCounter.
   * Format: {random_8_chars}-{sequence}/2009/D.15/{roman_month}/{year}
   * @param {string} type - Letter type
   * @returns {Promise<string>} Letter number
   */
  async generateLetterNumber(type) {
    const { letterNumber } = await this.generateLetterIdentity(type);
    return letterNumber;
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
   * Get Lurah info and active key for signing
   * @returns {Promise<object>} { keyRecord, lurahProfile, lurahName, lurahNip }
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
   * Issue a letter when the Lurah approves a submission.
   *
   * Executes a 7-phase pipeline per AGENTS.md:
   *   [1] Generate letter number (auto via LetterCounter)
   *   [2] Generate QR code data URL
   *   [3] Render HTML template → generate PDF bytes
   *   [4] Build canonical payload → compute hash → RSA-sign with lurah private key
   *   [5] Embed signature into PDF XMP metadata
   *   [6] Save signed PDF to disk
   *   [7] Update submission record → status APPROVED
   *
   * @param {object} params - Issue parameters
   * @param {string|BigInt} params.submissionId - Submission ID
   * @param {string|BigInt} params.lurahUserId - Lurah user ID (from req.user)
   * @param {string} params.passphrase - Passphrase to decrypt private key
   * @param {string} [params.note] - Lurah approval note
   * @param {string} [params.keterangan] - Additional description for the letter
   * @returns {Promise<object>} Issued letter result
   */
  async issueLetter({ submissionId, lurahUserId, passphrase, note, keterangan }) {
    // ---- Validations ----
    const submission = await prisma.submission.findUnique({
      where: { id: BigInt(submissionId) },
      include: {
        user: { include: { kependudukan: true } },
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

    if (submission.status !== 'pending_lurah') {
      const error = new Error('Submission tidak dalam status pending_lurah');
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

    if (!passphrase) {
      const error = new Error('Passphrase wajib diisi untuk menandatangani surat');
      error.code = 'BAD_REQUEST';
      throw error;
    }

    // ==================== PHASE 1: Generate letter number ====================
    const { verificationCode, letterNumber } = await this.generateLetterIdentity(submission.type);

    // Get template schema
    const schema = await templateService.getSchema(submission.type);

    // Get Lurah info and active key
    const { keyRecord, lurahName, lurahNip } = await this.getLurahInfo();

    // Build verification URL
    const baseUrl = (env.VERIFICATION_URL || '').replace(/\/+$/, '');
    const verificationUrl = `${baseUrl}/letters?code=${verificationCode}`;

    // Prepare template data
    const templateData = templateService.prepareTemplateData(submission, {
      letterNumber,
      lurahName,
      lurahNip,
      verificationUrl,
    });

    // ==================== PHASE 3: Render HTML template ====================
    const html = await templateService.renderTemplate(submission.type, templateData);

    // ==================== PHASE 4: Build canonical → hash → sign ====================
    const letterData = {
      type: submission.type,
      nomorSurat: letterNumber,
      nama: submission.user.kependudukan.nama,
      nik: submission.user.kependudukan.nik,
      tanggalLahir: submission.user.kependudukan.tanggalLahir ? new Date(submission.user.kependudukan.tanggalLahir).toISOString().split('T')[0] : null,
      lingkungan: submission.lingkungan.nama,
      tujuan: submission.payload?.tujuan || null,
    };

    const issuerData = {
      namaLurah: lurahName,
      nipLurah: lurahNip,
      kelurahan: 'Talete Satu',
      kecamatan: 'Tomohon Tengah',
      kota: 'Tomohon',
    };

    const issuedDate = new Date().toISOString();
    const metadata = {
      verificationCode,
      issuedDate,
    };

    // Sign with Lurah's private key (passphrase decrypts it)
    const signatureData = await cryptoService.createLetterSignature(letterData, issuerData, metadata, keyRecord, passphrase);

    // ==================== PHASES 2, 5, 6: QR + Embed XMP + Save PDF ====================
    const pdfResult = await pdfService.generateLetterPdf({
      html,
      verificationCode,
      verificationUrl,
      letterNumber,
      issuedDate,
      signatureData,
    });

    // Calculate expiry date
    let expiresAt = null;
    if (schema.validityDays) {
      expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + schema.validityDays);
    }

    // ==================== PHASE 7: Update submission record → status APPROVED ====================
    const result = await prisma.$transaction(async (tx) => {
      // Create lurah approval record
      await tx.submissionApproval.create({
        data: {
          submissionId: BigInt(submissionId),
          approvedBy: BigInt(lurahUserId),
          stage: 'lurah',
          status: 'approved',
          note: note || null,
        },
      });

      // Create issued letter record. If runtime Prisma client is stale and does not
      // expose `signatureKeyId` yet, retry without it so signing flow stays available.
      const issuedLetterData = {
        submissionId: BigInt(submissionId),
        letterNumber,
        verificationCode,
        type: submission.type,
        keterangan: keterangan || null,
        canonicalData: signatureData.canonicalData,
        canonicalHash: signatureData.canonicalHash,
        signature: signatureData.signature,
        signedBy: keyRecord.lurahProfileId,
        pdfPath: pdfResult.relativePath,
        expiresAt,
      };

      let issuedLetter;
      try {
        issuedLetter = await tx.issuedLetter.create({
          data: {
            ...issuedLetterData,
            signatureKeyId: keyRecord.id,
          },
        });
      } catch (error) {
        const isUnknownSignatureKeyId = error?.name === 'PrismaClientValidationError' && String(error?.message || '').includes('Unknown argument `signatureKeyId`');

        if (!isUnknownSignatureKeyId) {
          throw error;
        }

        issuedLetter = await tx.issuedLetter.create({
          data: issuedLetterData,
        });
      }

      // Update submission status to approved (letter generated + digitally signed)
      await tx.submission.update({
        where: { id: BigInt(submissionId) },
        data: { status: 'approved' },
      });

      return issuedLetter;
    });

    return {
      issuedLetter: result,
      letterNumber,
      verificationCode,
      verificationUrl,
      pdfPath: pdfResult.relativePath,
      expiresAt,
    };
  }

  // ==================== LETTER QUERIES ====================

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
            user: { include: { kependudukan: true } },
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
   * Get issued letter by submission ID
   * @param {string|BigInt} submissionId - Submission ID
   * @returns {Promise<object>} Issued letter
   */
  async getLetterBySubmissionId(submissionId) {
    const letter = await prisma.issuedLetter.findUnique({
      where: { submissionId: BigInt(submissionId) },
      include: {
        submission: {
          include: {
            user: { include: { kependudukan: true } },
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

  // ==================== VERIFICATION ====================

  /**
   * Verify letter authenticity
   * @param {string} verificationCode - Verification code
   * @returns {Promise<object>} Verification result
   */
  async verifyLetter(verificationCode) {
    const letter = await this.getLetterByVerificationCode(verificationCode);

    // Look up the public key — prefer signatureKeyId (exact match)
    const keyRecord = letter.signatureKeyId
      ? await prisma.lurahKey.findUnique({ where: { id: letter.signatureKeyId } })
      : await prisma.lurahKey.findFirst({
          where: { lurahProfileId: letter.signedBy },
          orderBy: { createdAt: 'desc' },
        });

    if (!keyRecord) {
      return {
        valid: false,
        reason: 'Kunci publik penanda tangan tidak ditemukan',
        letter: null,
      };
    }

    // Verify digital signature
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

  // ==================== LETTER ACCESS ====================

  /**
   * Get issued letters for a user
   */
  async getLettersByUser({ userId, page = 1, limit = 10 }) {
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [letters, total] = await Promise.all([
      prisma.issuedLetter.findMany({
        where: { submission: { userId: BigInt(userId) } },
        skip,
        take: parseInt(limit),
        orderBy: { issuedAt: 'desc' },
        include: { submission: { include: { lingkungan: true } } },
      }),
      prisma.issuedLetter.count({
        where: { submission: { userId: BigInt(userId) } },
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
   * Get all issued letters (admin/lurah)
   */
  async getAllLetters({ page = 1, limit = 10, type, lingkungan, search }) {
    const parsedPage = parseInt(page);
    const parsedLimit = parseInt(limit);
    const skip = (parsedPage - 1) * parsedLimit;
    const where = {};
    const rawWhere = [];

    if (type) where.type = type;
    if (type) rawWhere.push(Prisma.sql`il.type::text = ${type}`);
    if (lingkungan) {
      const lingkunganId = parseBigIntFilter(lingkungan, 'lingkungan');
      where.submission = { lingkunganId };
      rawWhere.push(Prisma.sql`s.lingkungan_id = ${lingkunganId}`);
    }
    if (search) {
      where.letterNumber = {
        contains: search,
        mode: 'insensitive',
      };
      rawWhere.push(Prisma.sql`il.letter_number ILIKE ${`%${search}%`}`);
    }

    const whereSql = rawWhere.length ? Prisma.sql`WHERE ${Prisma.join(rawWhere, ' AND ')}` : Prisma.empty;

    const [orderedRows, total] = await Promise.all([
      prisma.$queryRaw`
        SELECT il.id
        FROM issued_letters il
        JOIN submissions s ON s.id = il.submission_id
        ${whereSql}
        ORDER BY
          substring(il.letter_number FROM '-([0-9]{3})/')::int ASC NULLS LAST,
          il.issued_at ASC,
          il.id ASC
        LIMIT ${parsedLimit}
        OFFSET ${skip}
      `,
      prisma.issuedLetter.count({ where }),
    ]);

    const orderedIds = orderedRows.map((row) => row.id);
    const orderIndex = new Map(orderedIds.map((id, index) => [id.toString(), index]));
    const letters = orderedIds.length
      ? await prisma.issuedLetter.findMany({
          where: { id: { in: orderedIds } },
          include: {
            submission: {
              include: {
                user: { include: { kependudukan: true } },
                lingkungan: true,
              },
            },
          },
        })
      : [];

    letters.sort((a, b) => orderIndex.get(a.id.toString()) - orderIndex.get(b.id.toString()));

    return {
      letters,
      pagination: {
        page: parsedPage,
        limit: parsedLimit,
        total,
        total_pages: Math.ceil(total / parsedLimit),
      },
    };
  }

  // ==================== REVOCATION ====================

  /**
   * Revoke an issued letter
   */
  async revokeLetter({ verificationCode, reason }) {
    const letter = await this.getLetterByVerificationCode(verificationCode);

    if (letter.isRevoked) {
      const error = new Error('Surat sudah dicabut sebelumnya');
      error.code = 'BAD_REQUEST';
      throw error;
    }

    return prisma.issuedLetter.update({
      where: { id: letter.id },
      data: {
        isRevoked: true,
        revokedAt: new Date(),
        revokedReason: reason,
      },
      include: {
        submission: {
          include: {
            user: { include: { kependudukan: true } },
            lingkungan: true,
          },
        },
      },
    });
  }
}

export default new LetterService();
