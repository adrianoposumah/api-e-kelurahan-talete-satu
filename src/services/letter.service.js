import { randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../config/prisma.js';
import templateService from './template.service.js';
import cryptoService from './crypto.service.js';
import pdfService from './pdf.service.js';
import env from '../config/env.js';

const GLOBAL_LETTER_COUNTER_TYPE = 'GLOBAL';

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
 * Orchestrates the 8-phase letter issuance pipeline triggered
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
   * Generate letter identity using atomic global LetterCounter.
   * Verification code format: {random_8_chars}-{sequence}
   * Letter number format: {verificationCode}/{kelurahanCode}/{letterPrefix}/{roman_month}/{year}
   * @param {string} _type - Letter type (kept for backwards-compatible calls)
   * @returns {Promise<{ verificationCode: string, letterNumber: string }>} Letter identity
   */
  async generateLetterIdentity(_type) {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const counterType = typeof _type === 'string' ? _type.trim() : '';
    const schema = await templateService.getSchema(counterType);
    const letterPrefix = typeof schema.letterPrefix === 'string' ? schema.letterPrefix.trim() : '';

    if (!letterPrefix) {
      const error = new Error(`Letter prefix untuk tipe '${counterType}' belum dikonfigurasi`);
      error.code = 'BAD_REQUEST';
      throw error;
    }

    const rows = await prisma.$transaction(async (tx) => {
      // Global counter determines the actual letter number sequence.
      const globalRows = await tx.$queryRaw`
        INSERT INTO letter_counters (letter_type, year, sequence)
        VALUES (${GLOBAL_LETTER_COUNTER_TYPE}, ${year}, 1)
        ON CONFLICT (letter_type, year)
        DO UPDATE SET sequence = letter_counters.sequence + 1
        RETURNING sequence
      `;

      // Per-type counter is kept for yearly reporting only.
      if (counterType && counterType !== GLOBAL_LETTER_COUNTER_TYPE) {
        await tx.$queryRaw`
          INSERT INTO letter_counters (letter_type, year, sequence)
          VALUES (${counterType}, ${year}, 1)
          ON CONFLICT (letter_type, year)
          DO UPDATE SET sequence = letter_counters.sequence + 1
          RETURNING sequence
        `;
      }

      return globalRows;
    });

    const sequence = Number(rows?.[0]?.sequence || 1);
    const seq = String(sequence).padStart(3, '0');
    const verificationCode = `${this.generateVerificationPrefix()}-${seq}`;
    const kelurahanCode = env.KELURAHAN_CODE || '2009';
    const letterNumber = `${verificationCode}/${kelurahanCode}/${letterPrefix}/${this.getRomanMonth(month)}/${year}`;

    return { verificationCode, letterNumber };
  }

  /**
   * Generate letter number using atomic global LetterCounter.
   * Format: {random_8_chars}-{sequence}/{kelurahanCode}/{letterPrefix}/{roman_month}/{year}
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
   * Executes the v1.1 8-phase pipeline:
   *   [1] Generate letter number (auto via LetterCounter)
   *   [2] Render HTML template → raw PDF bytes
   *   [3] Compute body hash from raw PDF text
   *   [4] Build canonical payload with body_hash → RSA-sign with lurah private key
   *   [5] Embed signature into PDF metadata
   *   [6] Save signed PDF to disk
   *   [7] Create issued letter record
   *   [8] Update submission record → status APPROVED
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

    // ==================== PHASE 2: Render HTML template → raw PDF ====================
    const html = await templateService.renderTemplate(submission.type, templateData);
    const { pdfBuffer: rawPdfBuffer } = await pdfService.renderHtmlToPdf({ html, verificationUrl });

    // ==================== PHASE 3: Compute body hash ====================
    const bodyHash = await pdfService.computeContentHash(rawPdfBuffer);

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
    const signedAt = new Date().toISOString();
    const metadata = {
      verificationCode,
      issuedDate,
      signedAt,
      bodyHash,
    };

    // Sign with Lurah's private key (passphrase decrypts it)
    const signatureData = await cryptoService.createLetterSignature(letterData, issuerData, metadata, keyRecord, passphrase);

    // ==================== PHASES 5-6: Embed metadata + save PDF ====================
    const pdfResult = await pdfService.finalizeSignedPdf({
      rawPdfBuffer,
      verificationCode,
      letterNumber,
      issuedDate,
      signedAt,
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

      // Create issued letter record with the exact signing key ID.
      const issuedLetter = await tx.issuedLetter.create({
        data: {
          submissionId: BigInt(submissionId),
          letterNumber,
          verificationCode,
          type: submission.type,
          keterangan: keterangan || null,
          canonicalData: signatureData.canonicalData,
          canonicalHash: signatureData.canonicalHash,
          signature: signatureData.signature,
          signatureKeyId: keyRecord.id,
          signedBy: keyRecord.lurahProfileId,
          pdfPath: pdfResult.relativePath,
          expiresAt,
        },
      });

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
      bodyHash,
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
   * Verify letter authenticity through the unified hybrid verification flow.
   * @param {string} verificationCode - Verification code
   * @returns {Promise<object>} Verification result
   */
  async verifyLetter(verificationCode) {
    return this.verifyLetterByCode(verificationCode);
  }

  /**
   * Verify a generated PDF by verification code through verification.service.js.
   * @param {string} verificationCode - Verification code
   * @returns {Promise<object>} Hybrid verification result
   */
  async verifyLetterByCode(verificationCode) {
    const verificationService = (await import('./verification.service.js')).default;
    return verificationService.verifyLetterByCode(verificationCode);
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
