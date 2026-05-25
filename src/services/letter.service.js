import { randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../config/prisma.js';
import templateService from './template.service.js';
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
