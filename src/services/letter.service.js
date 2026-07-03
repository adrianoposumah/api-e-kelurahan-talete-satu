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
    return this.buildLetterIdentity(sequence, letterPrefix, now);
  }

  /**
   * Materialize a letter number + verification code from a sequence value.
   * The sequence is the gapless unit; the surrounding string (kelurahan code,
   * type prefix, roman month, year) and the random verification prefix are
   * derived here so a recycled sequence can pick up a new type/month context.
   * @param {number} sequence - Global letter sequence
   * @param {string} letterPrefix - Per-type prefix from the template schema
   * @param {Date} now - Reference date for month/year
   * @returns {{ verificationCode: string, letterNumber: string }}
   */
  buildLetterIdentity(sequence, letterPrefix, now = new Date()) {
    const seq = String(sequence).padStart(3, '0');
    const verificationCode = `${this.generateVerificationPrefix()}-${seq}`;
    const kelurahanCode = env.KELURAHAN_CODE || '2009';
    const month = now.getMonth() + 1;
    const letterNumber = `${verificationCode}/${kelurahanCode}/${letterPrefix}/${this.getRomanMonth(month)}/${now.getFullYear()}`;
    return { verificationCode, letterNumber };
  }

  /**
   * Reserve a gapless letter identity bound to a submission.
   *
   * Guarantees the issued register has no skipped numbers:
   *  1. Idempotent — if the submission already holds a RESERVED slot, its stored
   *     number is returned unchanged (so re-pressing "Setujui & Tandatangani" or
   *     re-preparing after a session expiry never consumes a new number).
   *  2. Reclaim — otherwise the lowest RELEASED slot for the year is recycled
   *     (its sequence is kept, the string/verification code are regenerated for
   *     this submission's type and current month).
   *  3. Fresh — otherwise the global counter is bumped and a new slot created.
   *
   * @param {object} args
   * @param {string} args.type - Letter/submission type
   * @param {string|BigInt} args.submissionId - Owning submission id
   * @returns {Promise<{ sequence: number, letterNumber: string, verificationCode: string }>}
   */
  async reserveLetterIdentity({ type, submissionId }) {
    const now = new Date();
    const year = now.getFullYear();
    const counterType = typeof type === 'string' ? type.trim() : '';
    const schema = await templateService.getSchema(counterType);
    const letterPrefix = typeof schema.letterPrefix === 'string' ? schema.letterPrefix.trim() : '';

    if (!letterPrefix) {
      const error = new Error(`Letter prefix untuk tipe '${counterType}' belum dikonfigurasi`);
      error.code = 'BAD_REQUEST';
      throw error;
    }

    const submissionBigInt = BigInt(submissionId);

    return prisma.$transaction(async (tx) => {
      // 1. Idempotent — reuse this submission's existing reservation verbatim.
      const existing = await tx.letterReservation.findFirst({
        where: { submissionId: submissionBigInt, status: 'RESERVED' },
      });
      if (existing) {
        return {
          sequence: existing.sequence,
          letterNumber: existing.letterNumber,
          verificationCode: existing.verificationCode,
        };
      }

      // 2. Reclaim — recycle the lowest freed slot for the year, if any.
      const freed = await tx.$queryRaw`
        SELECT id, sequence
        FROM letter_reservations
        WHERE status = 'RELEASED' AND year = ${year}
        ORDER BY sequence ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `;
      if (freed && freed.length > 0) {
        const sequence = Number(freed[0].sequence);
        const { verificationCode, letterNumber } = this.buildLetterIdentity(sequence, letterPrefix, now);
        await tx.letterReservation.update({
          where: { id: freed[0].id },
          data: { status: 'RESERVED', submissionId: submissionBigInt, letterNumber, verificationCode },
        });
        return { sequence, letterNumber, verificationCode };
      }

      // 3. Fresh — bump the global counter (and per-type counter for reporting).
      const globalRows = await tx.$queryRaw`
        INSERT INTO letter_counters (letter_type, year, sequence)
        VALUES (${GLOBAL_LETTER_COUNTER_TYPE}, ${year}, 1)
        ON CONFLICT (letter_type, year)
        DO UPDATE SET sequence = letter_counters.sequence + 1
        RETURNING sequence
      `;

      if (counterType && counterType !== GLOBAL_LETTER_COUNTER_TYPE) {
        await tx.$queryRaw`
          INSERT INTO letter_counters (letter_type, year, sequence)
          VALUES (${counterType}, ${year}, 1)
          ON CONFLICT (letter_type, year)
          DO UPDATE SET sequence = letter_counters.sequence + 1
          RETURNING sequence
        `;
      }

      const sequence = Number(globalRows?.[0]?.sequence || 1);
      const { verificationCode, letterNumber } = this.buildLetterIdentity(sequence, letterPrefix, now);
      await tx.letterReservation.create({
        data: {
          year,
          sequence,
          letterNumber,
          verificationCode,
          status: 'RESERVED',
          submissionId: submissionBigInt,
        },
      });
      return { sequence, letterNumber, verificationCode };
    });
  }

  /**
   * Mark a submission's reservation as permanently used (called inside the
   * issuance transaction). No-op if the submission has no active reservation.
   * @param {object} args
   * @param {string|BigInt} args.submissionId
   * @param {object} [tx=prisma] - Prisma client or transaction client
   */
  async markReservationIssued({ submissionId }, tx = prisma) {
    return tx.letterReservation.updateMany({
      where: { submissionId: BigInt(submissionId), status: 'RESERVED' },
      data: { status: 'ISSUED' },
    });
  }

  /**
   * Return a submission's reserved number to the free-list (called when a
   * previewed submission is rejected). No-op if it never reserved a number.
   * @param {object} args
   * @param {string|BigInt} args.submissionId
   * @param {object} [tx=prisma] - Prisma client or transaction client
   */
  async releaseReservation({ submissionId }, tx = prisma) {
    return tx.letterReservation.updateMany({
      where: { submissionId: BigInt(submissionId), status: 'RESERVED' },
      data: { status: 'RELEASED', submissionId: null },
    });
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
