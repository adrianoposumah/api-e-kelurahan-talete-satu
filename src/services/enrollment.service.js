import crypto from 'crypto';
import prisma from '../config/prisma.js';
import caService from './ca.service.js';

const TOKEN_TTL_MS = 10 * 60 * 1000;
const enrollmentTokens = new Map();

function nowMs() {
  return Date.now();
}

function cleanupExpiredTokens() {
  const now = nowMs();
  for (const [token, entry] of enrollmentTokens.entries()) {
    if (entry.used || entry.expiresAtMs <= now) {
      enrollmentTokens.delete(token);
    }
  }
}

setInterval(cleanupExpiredTokens, 5 * 60 * 1000).unref?.();

function createError(code, message, details = undefined) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

class EnrollmentService {
  async getActiveLurahProfile(lurahUserId) {
    const profile = await prisma.lurahProfile.findFirst({
      where: { userId: BigInt(lurahUserId), isActive: true },
      include: { user: true },
    });

    if (!profile) {
      throw createError('NOT_FOUND', 'Lurah profile tidak ditemukan atau tidak aktif');
    }
    return profile;
  }

  async getActiveCertificateKey(lurahUserId) {
    const profile = await this.getActiveLurahProfile(lurahUserId);
    return prisma.lurahKey.findFirst({
      where: {
        lurahProfileId: profile.id,
        status: 'ACTIVE',
        certificatePem: { not: null },
        expiresAt: { gt: new Date() },
      },
      orderBy: { enrolledAt: 'desc' },
    });
  }

  async issueEnrollmentToken(lurahUserId) {
    await this.getActiveLurahProfile(lurahUserId);
    const existing = await this.getActiveCertificateKey(lurahUserId);
    if (existing) {
      throw createError('ALREADY_ENROLLED', 'Lurah sudah memiliki sertifikat aktif. Lakukan revoke atau rotate dulu.', {
        activeKeyId: existing.id.toString(),
        issuedAt: existing.enrolledAt,
      });
    }

    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(nowMs() + TOKEN_TTL_MS);
    enrollmentTokens.set(token, {
      lurahUserId: BigInt(lurahUserId).toString(),
      expiresAtMs: expiresAt.getTime(),
      used: false,
    });

    return {
      enrollmentToken: token,
      expiresAt,
      subjectTemplate: caService.getSubjectTemplate(),
    };
  }

  validateToken(lurahUserId, token) {
    const entry = enrollmentTokens.get(token);
    if (!entry || entry.used) {
      throw createError('INVALID_INPUT', 'Enrollment token tidak valid');
    }
    if (entry.expiresAtMs <= nowMs()) {
      enrollmentTokens.delete(token);
      throw createError('ENROLLMENT_TOKEN_EXPIRED', 'Enrollment token sudah expired');
    }
    if (entry.lurahUserId !== BigInt(lurahUserId).toString()) {
      throw createError('INVALID_INPUT', 'Enrollment token tidak cocok dengan user');
    }
    return entry;
  }

  async submitCsr(lurahUserId, { enrollmentToken, csrPem, deviceLabel = null }) {
    const profile = await this.getActiveLurahProfile(lurahUserId);
    const existing = await this.getActiveCertificateKey(lurahUserId);
    if (existing) {
      throw createError('ALREADY_ENROLLED', 'Lurah sudah memiliki sertifikat aktif. Lakukan revoke atau rotate dulu.');
    }

    const tokenEntry = this.validateToken(lurahUserId, enrollmentToken);
    const signed = caService.signCsr(csrPem);

    const keyRecord = await prisma.$transaction(async (tx) => {
      await tx.lurahKey.updateMany({
        where: { lurahProfileId: profile.id, status: 'ACTIVE' },
        data: {
          status: 'INACTIVE',
          deactivatedAt: new Date(),
          deactivateReason: 'SUPERSEDED_BY_MOBILE_KEY_ENROLLMENT',
        },
      });

      return tx.lurahKey.create({
        data: {
          lurahProfileId: profile.id,
          publicKey: signed.publicKeyPem,
          encryptedPrivateKey: null,
          algorithm: 'RSA-SHA256',
          status: 'ACTIVE',
          certificatePem: signed.certificatePem,
          serialNumber: signed.serialNumber,
          fingerprint: signed.fingerprint,
          deviceLabel: deviceLabel || null,
          enrolledAt: signed.issuedAt,
          expiresAt: signed.expiresAt,
        },
      });
    });

    tokenEntry.used = true;

    return {
      keyId: keyRecord.id.toString(),
      certificatePem: signed.certificatePem,
      rootCaCertificatePem: caService.getRootCaPem(),
      serialNumber: signed.serialNumber,
      fingerprint: signed.fingerprint,
      algorithm: keyRecord.algorithm,
      issuedAt: signed.issuedAt,
      expiresAt: signed.expiresAt,
    };
  }

  async getCertificate(lurahUserId) {
    return this.getActiveCertificateKey(lurahUserId);
  }
}

export default new EnrollmentService();
