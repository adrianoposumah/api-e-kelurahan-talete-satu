import { basename, dirname, isAbsolute, relative, resolve } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import prisma from '../config/prisma.js';
import cryptoService from './crypto.service.js';
import pdfService from './pdf.service.js';
import pkcs7Service from './pkcs7.service.js';
import caService from './ca.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..', '..');
const PUBLIC_LETTERS_DIR = resolve(PROJECT_ROOT, 'public', 'letters');

class VerificationService {
  resolvePublicLetterPath(filePath) {
    const storedPath = String(filePath || '');
    const isDriveAbsolutePath = /^[a-zA-Z]:[\\/]/.test(storedPath) || storedPath.startsWith('\\\\');
    const absolutePath = isDriveAbsolutePath ? resolve(storedPath) : resolve(PROJECT_ROOT, storedPath.replace(/^[/\\]+/, ''));
    const relativeToLettersDir = relative(PUBLIC_LETTERS_DIR, absolutePath);
    const isInsideLettersDir = relativeToLettersDir === '' || (!relativeToLettersDir.startsWith('..') && !isAbsolute(relativeToLettersDir));

    if (!isInsideLettersDir) {
      const error = new Error('Stored PDF path is outside public letters directory');
      error.code = 'BAD_REQUEST';
      throw error;
    }

    return {
      absolutePath,
      publicPath: `/${relative(PROJECT_ROOT, absolutePath).replace(/\\/g, '/')}`,
    };
  }

  async readStoredPdf(issuedLetter) {
    const candidatePaths = [issuedLetter.pdfPath, pdfService.getPdfPath(issuedLetter.verificationCode)].filter(Boolean);
    const seen = new Set();

    for (const candidatePath of candidatePaths) {
      const pdfPath = this.resolvePublicLetterPath(candidatePath);
      if (seen.has(pdfPath.absolutePath)) continue;
      seen.add(pdfPath.absolutePath);

      if (existsSync(pdfPath.absolutePath)) {
        return {
          buffer: await readFile(pdfPath.absolutePath),
          publicPath: pdfPath.publicPath,
          filename: basename(pdfPath.absolutePath),
        };
      }
    }

    const error = new Error('Stored PDF file was not found on server');
    error.code = 'NOT_FOUND';
    throw error;
  }

  hasPadesSignature(pdfBuffer) {
    const text = Buffer.from(pdfBuffer).toString('latin1');
    return text.includes('/ByteRange') && text.includes('/SubFilter /ETSI.CAdES.detached');
  }

  trimPaddedSignatureHex(contentsHex) {
    let trimmed = String(contentsHex || '')
      .replace(/[^0-9a-f]/gi, '')
      .replace(/0+$/g, '');
    if (trimmed.length % 2 !== 0) trimmed += '0';
    return trimmed;
  }

  matchVerificationCode(payload) {
    return (
      String(payload || '')
        .match(/[A-F0-9]{8}-\d{3}/i)?.[0]
        ?.toUpperCase() || null
    );
  }

  /**
   * Extract verification code from a PDF by decoding the embedded QR code.
   * The QR remains parseable even when the PAdES signature is stripped or
   * the visible text is altered — this is the channel that lets the server
   * branch of hybrid verification still return a verdict for QR-transplant
   * forgeries. When QR decoding fails, callers can still verify by passing
   * the code directly to verifyLetterByCode().
   *
   * @param {Buffer|Uint8Array} pdfBuffer - PDF bytes
   * @returns {Promise<{ code: string|null, source: 'qr'|null }>}
   */
  async extractVerificationCodeFromPdf(pdfBuffer) {
    const qrPayload = await pdfService.extractQRCodeFromPdf(pdfBuffer);
    const fromQr = this.matchVerificationCode(qrPayload);
    return fromQr ? { code: fromQr, source: 'qr' } : { code: null, source: null };
  }

  async runServerCheck(verificationCode) {
    const checks = {
      codePresent: { pass: false, detail: null },
      registered: { pass: null, detail: null },
      notRevoked: { pass: null, detail: null },
      notExpired: { pass: null, detail: null },
    };

    if (!verificationCode) {
      checks.codePresent.detail = 'Verification code tidak ditemukan di PDF';
      return {
        pass: false,
        status: 'not_found',
        reason: 'Verification code tidak ditemukan di PDF',
        issuedLetter: null,
        checks,
      };
    }
    checks.codePresent = { pass: true, detail: `Kode verifikasi terbaca: ${verificationCode}` };

    const issuedLetter = await prisma.issuedLetter.findUnique({
      where: { verificationCode },
      include: {
        submission: true,
        signatureKey: true,
      },
    });

    if (!issuedLetter) {
      checks.registered.detail = 'Letter code not found in records';
      return { pass: false, status: 'not_found', reason: 'Letter code not found in records', issuedLetter: null, checks };
    }
    checks.registered = { pass: true, detail: `Surat terdaftar dengan nomor ${issuedLetter.letterNumber}` };

    if (issuedLetter.isRevoked) {
      const reason = `Letter has been revoked: ${issuedLetter.revokedReason || 'No reason provided'}`;
      checks.notRevoked = { pass: false, detail: reason };
      return { pass: false, status: 'revoked', reason, issuedLetter, checks };
    }
    checks.notRevoked = { pass: true, detail: 'Surat tidak berstatus dicabut' };

    if (issuedLetter.expiresAt && new Date() > issuedLetter.expiresAt) {
      const reason = `Letter expired on ${issuedLetter.expiresAt.toISOString()}`;
      checks.notExpired = { pass: false, detail: reason };
      return { pass: false, status: 'expired', reason, issuedLetter, checks };
    }
    checks.notExpired = {
      pass: true,
      detail: issuedLetter.expiresAt ? `Berlaku sampai ${issuedLetter.expiresAt.toISOString()}` : 'Surat tidak memiliki masa kedaluwarsa',
    };

    return { pass: true, status: 'pass', reason: 'Letter found in records', issuedLetter, checks };
  }

  async runSignatureCheck(pdfBuffer, issuedLetter) {
    const checks = {
      contentIntegrity: { pass: null, detail: null },
      signature: { pass: null, detail: null },
      certChain: { pass: null, detail: null },
      signerMatch: { pass: null, detail: null },
      keyStatus: { pass: null, detail: null },
      keyValidity: { pass: null, detail: null },
    };

    try {
      const { byteRange, contentsHex } = pdfService.extractByteRange(pdfBuffer);
      const pkcs7 = pkcs7Service.parsePkcs7FromHex(this.trimPaddedSignatureHex(contentsHex));
      const signerCommonName = pkcs7.signerCommonName || null;
      const computedHash = pdfService.computeByteRangeHash(pdfBuffer, byteRange);

      if (!computedHash.equals(pkcs7.messageDigest)) {
        checks.contentIntegrity = { pass: false, detail: 'PDF ByteRange hash tidak cocok dengan messageDigest PKCS#7' };
        return { pass: false, status: 'content_modified', reason: 'PDF ByteRange hash tidak cocok dengan messageDigest', signerCommonName, checks };
      }
      checks.contentIntegrity = { pass: true, detail: 'Hash ByteRange dokumen cocok dengan messageDigest PKCS#7' };

      const signatureValid = cryptoService.verifySignatureWithCertificate(pkcs7.signedAttributesDer, pkcs7.signatureBytes, pkcs7.signerCertPem);
      if (!signatureValid) {
        checks.signature = { pass: false, detail: 'PKCS#7 signature tidak valid terhadap signed attributes' };
        return { pass: false, status: 'signature_invalid', reason: 'PKCS#7 signature tidak valid', signerCommonName, checks };
      }
      checks.signature = { pass: true, detail: `Signature RSA-SHA256 valid (penanda tangan: ${signerCommonName || 'tidak diketahui'})` };

      const chainValid = cryptoService.verifyCertChain(pkcs7.signerCertPem, caService.getRootCaPem());
      if (!chainValid) {
        checks.certChain = { pass: false, detail: 'Sertifikat penanda tangan tidak terhubung ke Root CA terpercaya' };
        return { pass: false, status: 'untrusted', reason: 'Sertifikat penanda tangan tidak dipercaya', signerCommonName, checks };
      }
      checks.certChain = { pass: true, detail: 'Cert chain terverifikasi sampai ke Root CA Kelurahan Talete Satu' };

      if (!issuedLetter) {
        checks.signerMatch = { pass: null, detail: 'Surat tidak terdaftar; fingerprint server tidak dapat dibandingkan' };
        checks.keyStatus = { pass: null, detail: 'Surat tidak terdaftar; status key server tidak dapat dievaluasi' };
        checks.keyValidity = { pass: null, detail: 'Surat tidak terdaftar; masa berlaku key server tidak dapat dievaluasi' };
        return {
          pass: true,
          status: 'pass',
          reason: 'Crypto-Check valid; surat tidak ditemukan di rekaman server',
          signerCommonName,
          checks,
        };
      }

      if (issuedLetter?.signatureKey?.fingerprint) {
        const fingerprint = cryptoService.computeCertFingerprint(pkcs7.signerCertPem);
        if (fingerprint !== issuedLetter.signatureKey.fingerprint) {
          checks.signerMatch = { pass: false, detail: 'Fingerprint sertifikat penanda tangan tidak cocok dengan rekaman server' };
          return { pass: false, status: 'signer_mismatch', reason: 'Signer certificate tidak cocok dengan rekaman server', signerCommonName, checks };
        }
        checks.signerMatch = { pass: true, detail: `Fingerprint cocok dengan rekaman server (${fingerprint.slice(0, 16)}…)` };
      } else {
        checks.signerMatch = { pass: null, detail: 'Tidak ada fingerprint rekaman untuk dibandingkan' };
      }

      if (!issuedLetter?.signatureKey) {
        checks.keyStatus = { pass: false, detail: 'Rekaman key penanda tangan tidak ditemukan di server' };
        return { pass: false, status: 'missing_key_record', reason: 'Rekaman key penanda tangan tidak ditemukan', signerCommonName, checks };
      }

      if (issuedLetter.signatureKey.status !== 'ACTIVE') {
        const signedAt = issuedLetter.signedAt || issuedLetter.issuedAt;
        const deactivatedAt = issuedLetter.signatureKey.deactivatedAt;
        if (signedAt && deactivatedAt && signedAt <= deactivatedAt) {
          checks.keyStatus = {
            pass: true,
            detail: `Key berstatus ${issuedLetter.signatureKey.status}, tetapi surat ditandatangani sebelum key dinonaktifkan pada ${deactivatedAt.toISOString()} (grace period)`,
          };
          checks.keyValidity = { pass: true, detail: 'Tidak dievaluasi — diterima via grace period sebelum penonaktifan key' };
          return {
            pass: true,
            status: 'pass',
            reason: `Crypto-Check valid. Key penanda tangan saat ini berstatus ${issuedLetter.signatureKey.status}, tetapi surat ditandatangani sebelum key dinonaktifkan pada ${deactivatedAt.toISOString()}.`,
            signerCommonName,
            checks,
          };
        }

        checks.keyStatus = { pass: false, detail: `Key penanda tangan berstatus ${issuedLetter.signatureKey.status}` };
        return { pass: false, status: 'revoked_key', reason: `Key penanda tangan berstatus ${issuedLetter.signatureKey.status}`, signerCommonName, checks };
      }
      checks.keyStatus = { pass: true, detail: 'Key penanda tangan berstatus ACTIVE' };

      if (issuedLetter.signatureKey.expiresAt && new Date() > issuedLetter.signatureKey.expiresAt) {
        checks.keyValidity = { pass: false, detail: `Sertifikat penanda tangan expired pada ${issuedLetter.signatureKey.expiresAt.toISOString()}` };
        return { pass: false, status: 'expired_key', reason: `Sertifikat penanda tangan expired pada ${issuedLetter.signatureKey.expiresAt.toISOString()}`, signerCommonName, checks };
      }
      checks.keyValidity = {
        pass: true,
        detail: issuedLetter.signatureKey.expiresAt ? `Sertifikat berlaku sampai ${issuedLetter.signatureKey.expiresAt.toISOString()}` : 'Sertifikat tidak memiliki masa kedaluwarsa',
      };

      return {
        pass: true,
        status: 'pass',
        reason: 'Crypto-Check valid',
        signerCommonName,
        checks,
      };
    } catch (error) {
      return { pass: false, status: 'parse_error', reason: error.message, signerCommonName: null, checks };
    }
  }

  decideResult(serverResult, cryptoResult) {
    if (serverResult.status === 'pass' && cryptoResult.pass) return { valid: true, status: 'VALID', message: 'Surat valid' };
    if (serverResult.status === 'revoked' && cryptoResult.pass) return { valid: false, status: 'REVOKED', message: 'Surat telah dicabut' };
    if (serverResult.status === 'expired' && cryptoResult.pass) return { valid: false, status: 'EXPIRED', message: 'Surat sudah kadaluarsa' };
    if (serverResult.status === 'not_found' && cryptoResult.pass) return { valid: false, status: 'UNREGISTERED_BUT_VALID_SIGNATURE', message: 'Signature valid tetapi surat tidak terdaftar' };
    if (serverResult.status === 'pass' && cryptoResult.status === 'untrusted') return { valid: false, status: 'UNTRUSTED_SIGNER', message: 'Sertifikat penanda tangan tidak dipercaya' };
    if (serverResult.status === 'pass' && cryptoResult.status === 'revoked_key') return { valid: false, status: 'REVOKED_SIGNER', message: 'Key penanda tangan sudah dicabut atau tidak aktif' };
    if (serverResult.status === 'pass' && cryptoResult.status === 'expired_key') return { valid: false, status: 'EXPIRED_SIGNER', message: 'Sertifikat penanda tangan sudah expired' };
    if (serverResult.status === 'pass' && cryptoResult.status === 'missing_pades') {
      return {
        valid: false,
        status: 'TAMPERED_QR_TRANSPLANT',
        message: 'Kode verifikasi terdaftar tetapi dokumen tidak memiliki signature digital. Kemungkinan QR disalin dari surat lain.',
      };
    }
    if (serverResult.status === 'pass' && ['content_modified', 'signature_invalid', 'signer_mismatch'].includes(cryptoResult.status)) return { valid: false, status: 'TAMPERED', message: 'Surat dimodifikasi' };
    if (serverResult.status === 'pass' && cryptoResult.status === 'parse_error') return { valid: false, status: 'MALFORMED', message: 'Signature digital tidak dapat dibaca' };
    if (serverResult.status === 'not_found' && cryptoResult.status === 'missing_pades') return { valid: false, status: 'FAKE', message: 'Surat palsu' };
    return { valid: false, status: 'FAKE', message: 'Surat palsu' };
  }

  async verifyLetter(pdfBuffer) {
    const { code: verificationCode, source: codeSource } = await this.extractVerificationCodeFromPdf(pdfBuffer);
    const serverResult = await this.runServerCheck(verificationCode);

    const missingPadesChecks = {
      contentIntegrity: { pass: null, detail: 'Tidak ada signature digital untuk diperiksa' },
      signature: { pass: null, detail: 'Tidak ada signature digital untuk diperiksa' },
      certChain: { pass: null, detail: 'Tidak ada signature digital untuk diperiksa' },
      signerMatch: { pass: null, detail: 'Tidak ada signature digital untuk diperiksa' },
      keyStatus: { pass: null, detail: 'Tidak ada signature digital untuk diperiksa' },
      keyValidity: { pass: null, detail: 'Tidak ada signature digital untuk diperiksa' },
    };

    const cryptoResult = this.hasPadesSignature(pdfBuffer)
      ? await this.runSignatureCheck(pdfBuffer, serverResult.issuedLetter)
      : {
          pass: false,
          status: 'missing_pades',
          reason: 'PDF tidak memiliki signature digital (/ByteRange atau ETSI.CAdES.detached tidak ditemukan)',
          signerCommonName: null,
          checks: missingPadesChecks,
        };

    const decision = this.decideResult(serverResult, cryptoResult);

    this.recordVerificationAttempt({
      verificationCode,
      decision: decision.status,
      serverPass: serverResult.pass,
      cryptoPass: cryptoResult.pass,
      documentPass: cryptoResult.pass,
    }).catch(() => {});

    return {
      valid: decision.valid,
      status: decision.status,
      message: decision.message,
      serverCheck: {
        pass: serverResult.pass,
        status: serverResult.status,
        reason: serverResult.reason,
        codeSource,
        checks: serverResult.checks,
      },
      signatureCheck: {
        pass: cryptoResult.pass,
        status: cryptoResult.status,
        reason: cryptoResult.reason,
        signerCommonName: cryptoResult.signerCommonName || null,
        keyStatus: serverResult.issuedLetter?.signatureKey?.status || null,
        checks: cryptoResult.checks,
      },
      letter: serverResult.issuedLetter
        ? {
            letterNumber: serverResult.issuedLetter.letterNumber,
            letterType: serverResult.issuedLetter.type,
            issuedAt: serverResult.issuedLetter.issuedAt,
            formData: serverResult.issuedLetter.submission.payload || {},
          }
        : null,
    };
  }

  async verifyLetterByCode(verificationCode) {
    const normalizedCode = String(verificationCode || '').trim();
    if (!normalizedCode) {
      const error = new Error('Verification code is required');
      error.code = 'BAD_REQUEST';
      throw error;
    }

    const issuedLetter = await prisma.issuedLetter.findUnique({
      where: { verificationCode: normalizedCode },
      select: {
        verificationCode: true,
        pdfPath: true,
      },
    });

    if (!issuedLetter) {
      const error = new Error('Letter code not found in records');
      error.code = 'NOT_FOUND';
      throw error;
    }

    const storedPdf = await this.readStoredPdf(issuedLetter);
    const verificationResult = await this.verifyLetter(storedPdf.buffer);

    return {
      ...verificationResult,
      pdf: {
        filename: storedPdf.filename,
        path: storedPdf.publicPath,
        mimeType: 'application/pdf',
        size: storedPdf.buffer.length,
        dataUrl: `data:application/pdf;base64,${storedPdf.buffer.toString('base64')}`,
      },
    };
  }

  async recordVerificationAttempt({ verificationCode, decision, serverPass, cryptoPass, documentPass }) {
    if (!prisma.verificationLog) return;

    await prisma.verificationLog.create({
      data: {
        verificationCode: verificationCode || null,
        decisionStatus: decision,
        serverPass: !!serverPass,
        cryptoPass: !!cryptoPass,
        documentPass: !!documentPass,
      },
    });
  }
}

export default new VerificationService();
