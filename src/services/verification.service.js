import prisma from '../config/prisma.js';
import cryptoService from './crypto.service.js';
import pdfService from './pdf.service.js';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { basename, dirname, isAbsolute, relative, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..', '..');
const PUBLIC_LETTERS_DIR = resolve(PROJECT_ROOT, 'public', 'letters');

/**
 * Verification Service - Hybrid verification for uploaded letter PDF files.
 *
 * Validation is split into three independent checks:
 * 1) Server-based check against DB records.
 * 2) Cryptographic check against stored public key.
 * 3) Body content check against signed body_hash.
 */
class VerificationService {
  /**
   * Ensure a PDF path from the database resolves only to the public letters folder.
   * @param {string} filePath - Stored PDF path
   * @returns {{ absolutePath: string, publicPath: string }}
   */
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

  /**
   * Read the generated PDF stored for an issued letter.
   * @param {object} issuedLetter - Issued letter DB record
   * @returns {Promise<{ buffer: Buffer, publicPath: string, filename: string }>}
   */
  async readStoredPdf(issuedLetter) {
    const candidatePaths = [issuedLetter.pdfPath, pdfService.getPdfPath(issuedLetter.verificationCode)].filter(Boolean);
    const seen = new Set();

    for (const candidatePath of candidatePaths) {
      const pdfPath = this.resolvePublicLetterPath(candidatePath);

      if (seen.has(pdfPath.absolutePath)) {
        continue;
      }
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

  /**
   * Extract and validate required signature metadata from a PDF.
   * @param {Buffer} pdfBuffer - Uploaded PDF buffer
   * @returns {Promise<object>} Metadata fields
   */
  async extractMetadata(pdfBuffer) {
    const metadata = await pdfService.readSignatureMetadata(pdfBuffer);

    if (!metadata) {
      throw new Error('No signature metadata found in this file');
    }

    if (!metadata.verificationCode) {
      throw new Error('Incomplete metadata: verification code is missing');
    }

    if (!metadata.signatureValue) {
      throw new Error('Incomplete metadata: signature is missing');
    }

    return metadata;
  }

  /**
   * Run server-based check against issued letter records.
   * @param {object} metadata - Extracted PDF metadata
   * @returns {Promise<object>} Server check result with issued letter record
   */
  async runServerCheck(metadata) {
    const issuedLetter = await prisma.issuedLetter.findUnique({
      where: { verificationCode: metadata.verificationCode },
      include: {
        submission: true,
      },
    });

    if (!issuedLetter) {
      return {
        pass: false,
        status: 'not_found',
        reason: 'Letter code not found in records',
        issuedLetter: null,
      };
    }

    if (!['approved', 'issued'].includes(issuedLetter.submission.status)) {
      return {
        pass: false,
        status: 'not_approved',
        reason: 'Letter was not approved through the system',
        issuedLetter,
      };
    }

    if (issuedLetter.isRevoked) {
      return {
        pass: false,
        status: 'revoked',
        reason: `Letter has been revoked: ${issuedLetter.revokedReason || 'No reason provided'}`,
        issuedLetter,
      };
    }

    if (issuedLetter.expiresAt && new Date() > issuedLetter.expiresAt) {
      return {
        pass: false,
        status: 'expired',
        reason: `Letter expired on ${issuedLetter.expiresAt.toISOString()}`,
        issuedLetter,
      };
    }

    if (metadata.signatureValue !== issuedLetter.signature) {
      return {
        pass: false,
        status: 'mismatch',
        reason: 'Signature does not match records',
        issuedLetter,
      };
    }

    if (metadata.canonicalHash && metadata.canonicalHash !== issuedLetter.canonicalHash) {
      return {
        pass: false,
        status: 'mismatch',
        reason: 'Canonical hash does not match records',
        issuedLetter,
      };
    }

    if (metadata.canonicalPayload) {
      let decodedCanonicalPayload;

      try {
        decodedCanonicalPayload = Buffer.from(metadata.canonicalPayload, 'base64').toString('utf8');
      } catch {
        return {
          pass: false,
          status: 'malformed_metadata',
          reason: 'Canonical payload in metadata is malformed',
          issuedLetter,
        };
      }

      if (decodedCanonicalPayload !== issuedLetter.canonicalData) {
        return {
          pass: false,
          status: 'mismatch',
          reason: 'Canonical payload does not match records',
          issuedLetter,
        };
      }
    }

    if (metadata.signatureKeyId && issuedLetter.signatureKeyId && metadata.signatureKeyId !== issuedLetter.signatureKeyId.toString()) {
      return {
        pass: false,
        status: 'mismatch',
        reason: 'Signing key does not match records',
        issuedLetter,
      };
    }

    if (metadata.letterNumber && metadata.letterNumber !== issuedLetter.letterNumber) {
      return {
        pass: false,
        status: 'mismatch',
        reason: 'Letter number does not match records',
        issuedLetter,
      };
    }

    return {
      pass: true,
      status: 'pass',
      reason: 'Letter found in records with approved status',
      issuedLetter,
    };
  }

  /**
   * Decode canonical payload embedded in PDF metadata.
   * @param {object} metadata - Extracted metadata
   * @returns {string|null} Canonical JSON string or null
   */
  decodeCanonicalPayload(metadata) {
    if (!metadata.canonicalPayload) {
      return null;
    }

    try {
      return Buffer.from(metadata.canonicalPayload, 'base64').toString('utf8');
    } catch {
      return null;
    }
  }

  /**
   * Resolve key record used to verify a letter signature.
   * @param {object} metadata - Extracted metadata
   * @param {object|null} issuedLetter - Issued letter DB record
   * @returns {Promise<object|null>} Key record or null
   */
  async resolveKey(metadata, issuedLetter) {
    if (metadata.signatureKeyId) {
      try {
        return await prisma.lurahKey.findUnique({ where: { id: BigInt(metadata.signatureKeyId) } });
      } catch {
        return null;
      }
    }

    if (issuedLetter?.signatureKeyId) {
      return prisma.lurahKey.findUnique({ where: { id: issuedLetter.signatureKeyId } });
    }

    if (!issuedLetter) {
      return null;
    }

    return prisma.lurahKey.findFirst({
      where: { lurahProfileId: issuedLetter.signedBy },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Run cryptography-based signature verification.
   * @param {object} metadata - Extracted PDF metadata
   * @param {object|null} issuedLetter - Server-validated issued letter
   * @returns {Promise<object>} Crypto check result
   */
  async runCryptoCheck(metadata, issuedLetter) {
    const canonicalData = issuedLetter?.canonicalData || this.decodeCanonicalPayload(metadata);

    if (!canonicalData) {
      return {
        pass: false,
        reason: 'Canonical payload is not available for cryptographic verification',
        keyStatus: null,
      };
    }

    const keyRecord = await this.resolveKey(metadata, issuedLetter);

    if (!keyRecord) {
      return {
        pass: false,
        reason: 'Signing key not found',
        keyStatus: null,
      };
    }

    const isValid = cryptoService.verifyLetterSignature(canonicalData, metadata.signatureValue, keyRecord.publicKey);

    if (!isValid) {
      return {
        pass: false,
        reason: 'Digital signature is invalid — document may have been tampered with',
        keyStatus: keyRecord.status,
      };
    }

    const reason = keyRecord.status === 'REVOKED' ? 'Digital signature is mathematically valid (key has been revoked)' : 'Digital signature is valid';

    return {
      pass: true,
      reason,
      keyStatus: keyRecord.status,
    };
  }

  /**
   * Run body integrity verification against the signed canonical body_hash.
   * Legacy v1.0 letters do not have body_hash and are skipped for compatibility.
   * @param {Buffer} pdfBuffer - Uploaded PDF bytes
   * @param {object} metadata - Extracted PDF metadata
   * @param {object|null} issuedLetter - Server-side issued letter record
   * @returns {Promise<object>} Body check result
   */
  async runBodyCheck(pdfBuffer, metadata, issuedLetter) {
    const canonicalData = issuedLetter?.canonicalData || this.decodeCanonicalPayload(metadata);

    if (!canonicalData) {
      return {
        pass: false,
        reason: 'Canonical data unavailable for body integrity check',
      };
    }

    const expectedBodyHash = cryptoService.extractBodyHashFromCanonical(canonicalData);

    if (!expectedBodyHash) {
      return {
        pass: true,
        skipped: true,
        reason: 'Letter signed without body hash (pre-v1.1) — body integrity not verifiable',
      };
    }

    let actualBodyHash;
    try {
      actualBodyHash = await pdfService.computeContentHash(pdfBuffer);
    } catch (error) {
      return {
        pass: false,
        reason: `Failed to extract PDF text content: ${error.message}`,
      };
    }

    if (actualBodyHash !== expectedBodyHash) {
      return {
        pass: false,
        reason: 'PDF body content has been modified after signing',
        expectedBodyHash,
        actualBodyHash,
      };
    }

    return {
      pass: true,
      reason: 'PDF body content matches signed hash',
      expectedBodyHash,
      actualBodyHash,
    };
  }

  /**
   * Combine server, crypto, and body checks into the public verification decision.
   * @param {object} serverResult - Server-side check result
   * @param {object} cryptoResult - Cryptographic check result
   * @param {object} bodyResult - Body content check result
   * @returns {{ valid: boolean, status: string, message: string }}
   */
  decideVerificationResult(serverResult, cryptoResult, bodyResult) {
    const serverStatus = serverResult.status;
    const cryptoPass = cryptoResult.pass;
    const bodyPass = bodyResult.pass;

    if (serverStatus === 'not_found') {
      if (cryptoPass && bodyPass) {
        return { valid: false, status: 'NOT_REGISTERED', message: 'Surat tidak terdaftar di sistem' };
      }
      return { valid: false, status: 'FAKE', message: 'Surat palsu' };
    }

    if (serverStatus === 'malformed_metadata' || serverStatus === 'metadata_error') {
      return { valid: false, status: 'MALFORMED', message: 'Metadata surat tidak valid' };
    }

    if (serverStatus === 'not_approved') {
      return { valid: false, status: 'NOT_APPROVED', message: 'Surat belum disahkan' };
    }

    if (serverStatus === 'mismatch') {
      if (cryptoPass) {
        return { valid: false, status: 'RECORD_MISMATCH', message: 'Data surat tidak cocok dengan rekaman server' };
      }
      return { valid: false, status: 'TAMPERED', message: 'Surat dimodifikasi' };
    }

    if (serverStatus === 'revoked') {
      if (cryptoPass && bodyPass) {
        return { valid: false, status: 'REVOKED', message: 'Surat telah dicabut' };
      }
      return { valid: false, status: 'REVOKED_AND_MODIFIED', message: 'Surat telah dicabut dan dimodifikasi' };
    }

    if (serverStatus === 'expired') {
      if (cryptoPass && bodyPass) {
        return { valid: false, status: 'EXPIRED', message: 'Surat sudah kadaluarsa' };
      }
      return { valid: false, status: 'EXPIRED_AND_MODIFIED', message: 'Surat sudah kadaluarsa dan dimodifikasi' };
    }

    if (serverStatus === 'pass') {
      if (cryptoPass && bodyPass) return { valid: true, status: 'VALID', message: 'Surat valid' };
      if (!cryptoPass && !bodyPass) return { valid: false, status: 'TAMPERED', message: 'Surat dimodifikasi' };
      if (!cryptoPass) return { valid: false, status: 'CANONICAL_MODIFIED', message: 'Data tanda tangan dimodifikasi' };
      if (!bodyPass) return { valid: false, status: 'BODY_MODIFIED', message: 'Isi surat dimodifikasi' };
    }

    return { valid: false, status: 'INVALID', message: 'Surat tidak valid' };
  }

  /**
   * Verify uploaded letter PDF with hybrid verification.
   * @param {Buffer} pdfBuffer - Uploaded PDF bytes
   * @returns {Promise<object>} Hybrid verification result payload
   */
  async verifyLetter(pdfBuffer) {
    let metadata;

    try {
      metadata = await this.extractMetadata(pdfBuffer);
    } catch (error) {
      return {
        valid: false,
        status: 'MALFORMED',
        message: 'Metadata surat tidak valid',
        serverCheck: {
          pass: false,
          status: 'metadata_error',
          reason: error.message,
        },
        cryptoCheck: {
          pass: false,
          reason: 'Cannot verify without metadata',
          keyStatus: null,
        },
        bodyCheck: {
          pass: false,
          reason: 'Cannot verify body without metadata',
        },
        letter: null,
      };
    }

    const serverResult = await this.runServerCheck(metadata);
    const cryptoResult = await this.runCryptoCheck(metadata, serverResult.issuedLetter);
    const bodyResult = await this.runBodyCheck(pdfBuffer, metadata, serverResult.issuedLetter);
    const decision = this.decideVerificationResult(serverResult, cryptoResult, bodyResult);

    this.recordVerificationAttempt({
      verificationCode: metadata.verificationCode,
      decision: decision.status,
      serverPass: serverResult.pass,
      cryptoPass: cryptoResult.pass,
      bodyPass: bodyResult.pass,
    }).catch(() => {});

    return {
      valid: decision.valid,
      status: decision.status,
      message: decision.message,
      serverCheck: {
        pass: serverResult.pass,
        status: serverResult.status,
        reason: serverResult.reason,
      },
      cryptoCheck: {
        pass: cryptoResult.pass,
        reason: cryptoResult.reason,
        keyStatus: cryptoResult.keyStatus,
      },
      bodyCheck: {
        pass: bodyResult.pass,
        reason: bodyResult.reason,
        skipped: bodyResult.skipped || false,
      },
      letter: decision.valid
        ? {
            letterNumber: serverResult.issuedLetter.letterNumber,
            letterType: serverResult.issuedLetter.type,
            issuedAt: serverResult.issuedLetter.issuedAt,
            formData: serverResult.issuedLetter.submission.payload || {},
          }
        : null,
    };
  }

  /**
   * Verify a generated PDF by verification code.
   * The server loads the stored PDF and runs the same hybrid verification pipeline.
   * @param {string} verificationCode - Public verification code
   * @returns {Promise<object>} Hybrid verification result payload with PDF preview data
   */
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

  /**
   * Record a verification attempt for audit and forensics.
   * This is best-effort and remains a no-op until the optional Prisma model exists.
   * @param {object} params - Audit log parameters
   * @returns {Promise<void>}
   */
  async recordVerificationAttempt({ verificationCode, decision, serverPass, cryptoPass, bodyPass }) {
    if (!prisma.verificationLog) return;

    await prisma.verificationLog.create({
      data: {
        verificationCode: verificationCode || null,
        decisionStatus: decision,
        serverPass: !!serverPass,
        cryptoPass: !!cryptoPass,
        bodyPass: !!bodyPass,
      },
    });
  }
}

export default new VerificationService();
