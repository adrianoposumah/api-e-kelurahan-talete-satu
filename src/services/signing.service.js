import forge from 'node-forge';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname, resolve } from 'path';
import prisma from '../config/prisma.js';
import env from '../config/env.js';
import templateService from './template.service.js';
import pdfService from './pdf.service.js';
import letterService from './letter.service.js';
import pkcs7Service from './pkcs7.service.js';
import cryptoService from './crypto.service.js';

const SESSION_TTL_MS = 5 * 60 * 1000;

function makeError(code, message, status = 400, details = undefined) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details) error.details = details;
  return error;
}

function resolveProjectPath(pathValue) {
  return resolve(process.cwd(), pathValue);
}

function baseVerificationUrl() {
  return (env.VERIFICATION_URL || '').replace(/\/+$/, '');
}

class SigningService {
  async getActiveLurahProfile(lurahUserId) {
    const profile = await prisma.lurahProfile.findFirst({
      where: { userId: BigInt(lurahUserId), isActive: true },
      include: { user: true },
    });
    if (!profile) {
      throw makeError('NOT_FOUND', 'Lurah profile tidak ditemukan atau tidak aktif', 404);
    }
    return profile;
  }

  async getActiveCertificateKey(lurahUserId) {
    const profile = await this.getActiveLurahProfile(lurahUserId);
    const keyRecord = await prisma.lurahKey.findFirst({
      where: {
        lurahProfileId: profile.id,
        status: 'ACTIVE',
        certificatePem: { not: null },
        expiresAt: { gt: new Date() },
      },
      orderBy: { enrolledAt: 'desc' },
    });

    if (!keyRecord) {
      throw makeError('ENROLLMENT_REQUIRED', 'Lurah belum melakukan enrollment sertifikat', 412);
    }

    return { profile, keyRecord };
  }

  async loadSubmissionForSigning(submissionId) {
    const submission = await prisma.submission.findUnique({
      where: { id: BigInt(submissionId) },
      include: {
        user: { include: { kependudukan: true } },
        lingkungan: true,
        approvals: { include: { approver: true }, orderBy: { createdAt: 'asc' } },
        issuedLetter: true,
      },
    });

    if (!submission) {
      throw makeError('NOT_FOUND', 'Submission tidak ditemukan', 404);
    }
    if (submission.status !== 'pending_lurah') {
      throw makeError('INVALID_STATE', 'Submission tidak dalam status pending_lurah', 409, { currentStatus: submission.status });
    }
    if (submission.issuedLetter) {
      throw makeError('CONFLICT', 'Surat sudah pernah diterbitkan', 409);
    }
    if (!submission.user.kependudukan) {
      throw makeError('NOT_FOUND', 'Data kependudukan pemohon tidak ditemukan', 404);
    }

    return submission;
  }

  async prepareSigning({ submissionId, lurahUserId }) {
    const submission = await this.loadSubmissionForSigning(submissionId);
    const { profile, keyRecord } = await this.getActiveCertificateKey(lurahUserId);
    const { verificationCode, letterNumber } = await letterService.generateLetterIdentity(submission.type);
    const schema = await templateService.getSchema(submission.type);
    const issuedDate = new Date();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    const letterExpiresAt = schema.validityDays ? new Date(issuedDate.getTime() + schema.validityDays * 24 * 60 * 60 * 1000) : null;
    const verificationUrl = `${baseVerificationUrl()}/letters?code=${verificationCode}`;

    const templateData = templateService.prepareTemplateData(submission, {
      letterNumber,
      lurahName: profile.namaLengkap,
      lurahNip: profile.nip,
      verificationUrl,
    });
    const html = await templateService.renderTemplate(submission.type, templateData);
    const { pdfBuffer: rawPdfBuffer } = await pdfService.renderHtmlToPdf({ html, verificationUrl });
    const pdfWithPlaceholder = await pdfService.addByteRangePlaceholder(rawPdfBuffer);
    const { byteRange } = pdfService.extractByteRange(pdfWithPlaceholder);
    const byteRangeHash = pdfService.computeByteRangeHash(pdfWithPlaceholder, byteRange);
    const certObj = forge.pki.certificateFromPem(keyRecord.certificatePem);
    const bytesToSign = pkcs7Service.buildSignedAttributesDer(byteRangeHash, certObj, issuedDate);
    const bytesToSignBase64 = bytesToSign.toString('base64');

    const draftRelativePath = `storage/letter-drafts/draft_${submission.id}_${Date.now()}.pdf`;
    const draftPath = resolveProjectPath(draftRelativePath);
    await mkdir(dirname(draftPath), { recursive: true });
    await writeFile(draftPath, pdfWithPlaceholder);

    const session = await prisma.signingSession.create({
      data: {
        submissionId: submission.id,
        lurahProfileId: profile.id,
        keyId: keyRecord.id,
        bytesToSignBase64,
        pdfDraftPath: draftRelativePath,
        letterNumber,
        verificationCode,
        issuedDate,
        expiresAt,
      },
    });

    return {
      sessionId: session.id.toString(),
      expiresAt,
      pdfBase64: pdfWithPlaceholder.toString('base64'),
      bytesToSignBase64,
      preview: {
        letterNumber,
        verificationCode,
        issuedDate: issuedDate.toISOString(),
        expiresAt: letterExpiresAt?.toISOString() || null,
      },
    };
  }

  async submitSignature({ submissionId, lurahUserId, sessionId, signatureBase64, note = null, keterangan = null }) {
    const session = await prisma.signingSession.findUnique({
      where: { id: BigInt(sessionId) },
      include: { lurahKey: true, lurahProfile: true, submission: { include: { issuedLetter: true } } },
    });

    if (!session) {
      throw makeError('NOT_FOUND', 'Signing session tidak ditemukan', 404);
    }
    if (session.submissionId !== BigInt(submissionId)) {
      throw makeError('FORBIDDEN', 'Signing session tidak cocok dengan submission', 403);
    }
    if (session.lurahProfile.userId !== BigInt(lurahUserId)) {
      throw makeError('FORBIDDEN', 'Signing session tidak cocok dengan Lurah authenticated', 403);
    }
    if (session.status === 'COMPLETED') {
      throw makeError('SESSION_ALREADY_COMPLETED', 'Signing session sudah selesai', 409);
    }
    if (session.status !== 'PENDING' || session.expiresAt <= new Date()) {
      if (session.status === 'PENDING') {
        await prisma.signingSession.update({ where: { id: session.id }, data: { status: 'EXPIRED' } });
      }
      throw makeError('SESSION_EXPIRED', 'Signing session sudah lewat 5 menit. Mulai ulang dari prepare-signing.', 410);
    }
    if (session.submission.issuedLetter) {
      throw makeError('CONFLICT', 'Surat sudah pernah diterbitkan', 409);
    }
    if (session.lurahKey.status !== 'ACTIVE') {
      throw makeError('FORBIDDEN', 'Sertifikat penanda tangan sudah revoked atau inactive', 403);
    }

    const bytesToSign = Buffer.from(session.bytesToSignBase64, 'base64');
    const signatureBytes = Buffer.from(signatureBase64, 'base64');
    const valid = cryptoService.verifySignatureWithCertificate(bytesToSign, signatureBytes, session.lurahKey.certificatePem);
    if (!valid) {
      throw makeError('SIGNATURE_INVALID', 'Signature tidak valid untuk bytesToSign yang diberikan', 400, {
        expectedFingerprint: session.lurahKey.fingerprint,
      });
    }

    const draftPath = resolveProjectPath(session.pdfDraftPath);
    if (!existsSync(draftPath)) {
      throw makeError('DRAFT_NOT_FOUND', 'Draft PDF signing session tidak ditemukan', 500);
    }

    const draftPdfBytes = await readFile(draftPath);
    const certObj = forge.pki.certificateFromPem(session.lurahKey.certificatePem);
    const pkcs7 = pkcs7Service.assemblePkcs7SignedData(bytesToSign, signatureBytes, certObj);
    const { contentsHexOffset, contentsHexLength } = pdfService.extractByteRange(draftPdfBytes);
    const finalPdfBytes = pdfService.embedPkcs7Hex(draftPdfBytes, pkcs7.toString('hex'), contentsHexOffset, contentsHexLength);
    const pdfResult = await pdfService.savePdf(finalPdfBytes, `letter_${session.verificationCode}`);
    const signedAt = new Date();

    const submission = await prisma.submission.findUnique({
      where: { id: BigInt(submissionId) },
      include: { user: { include: { kependudukan: true } }, lingkungan: true },
    });
    const schema = await templateService.getSchema(submission.type);
    const letterExpiresAt = schema.validityDays ? new Date(session.issuedDate.getTime() + schema.validityDays * 24 * 60 * 60 * 1000) : null;

    const result = await prisma.$transaction(async (tx) => {
      await tx.submissionApproval.create({
        data: {
          submissionId: BigInt(submissionId),
          approvedBy: BigInt(lurahUserId),
          stage: 'lurah',
          status: 'approved',
          note,
        },
      });

      const issuedLetter = await tx.issuedLetter.create({
        data: {
          submissionId: BigInt(submissionId),
          letterNumber: session.letterNumber,
          verificationCode: session.verificationCode,
          type: submission.type,
          keterangan,
          signedBy: session.lurahProfileId,
          signatureKeyId: session.keyId,
          signedAt,
          pdfPath: pdfResult.relativePath,
          expiresAt: letterExpiresAt,
        },
      });

      await tx.submission.update({
        where: { id: BigInt(submissionId) },
        data: { status: 'approved' },
      });

      await tx.signingSession.update({
        where: { id: session.id },
        data: { status: 'COMPLETED', completedAt: signedAt },
      });

      return issuedLetter;
    });

    await unlink(draftPath).catch(() => {});

    return {
      submission,
      letter: {
        issuedLetterId: result.publicId || result.id.toString(),
        letterNumber: result.letterNumber,
        verificationCode: result.verificationCode,
        verificationUrl: `${baseVerificationUrl()}/letters?code=${result.verificationCode}`,
        pdfPath: result.pdfPath,
        signedAt: result.signedAt,
        expiresAt: result.expiresAt,
      },
    };
  }

  async cleanupExpiredSessions() {
    const expiredSessions = await prisma.signingSession.findMany({
      where: { status: 'PENDING', expiresAt: { lt: new Date() } },
      select: { id: true, pdfDraftPath: true },
    });

    if (expiredSessions.length === 0) {
      return { expiredSessions: 0, deletedDrafts: 0 };
    }

    await prisma.signingSession.updateMany({
      where: { id: { in: expiredSessions.map((session) => session.id) } },
      data: { status: 'EXPIRED' },
    });

    let deletedDrafts = 0;
    for (const session of expiredSessions) {
      const draftPath = resolveProjectPath(session.pdfDraftPath);
      try {
        await unlink(draftPath);
        deletedDrafts += 1;
      } catch {
        // Best-effort cleanup.
      }
    }

    return { expiredSessions: expiredSessions.length, deletedDrafts };
  }
}

export default new SigningService();
