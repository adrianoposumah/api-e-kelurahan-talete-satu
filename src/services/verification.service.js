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
 * Validation is split into two independent checks:
 * 1) Server-based check against DB records.
 * 2) Cryptographic check against stored public key.
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
   * Combine server and crypto checks into the public verification decision.
   * @param {object} serverResult - Server-side check result
   * @param {object} cryptoResult - Cryptographic check result
   * @returns {{ valid: boolean, status: string, message: string }}
   */
  decideVerificationResult(serverResult, cryptoResult) {
    if (serverResult.status === 'revoked' && cryptoResult.pass) {
      return {
        valid: false,
        status: 'REVOKED',
        message: 'Surat Revoked',
      };
    }

    if (serverResult.status === 'not_found' && cryptoResult.pass) {
      return {
        valid: false,
        status: 'FAKE',
        message: 'Surat Palsu',
      };
    }

    if (serverResult.pass && !cryptoResult.pass) {
      return {
        valid: false,
        status: 'MODIFIED',
        message: 'Surat dimodifikasi',
      };
    }

    if (!serverResult.pass && !cryptoResult.pass) {
      return {
        valid: false,
        status: 'FAKE_OR_NOT_FOUND',
        message: 'Surat Palsu/Tidak ada',
      };
    }

    if (serverResult.pass && cryptoResult.pass) {
      return {
        valid: true,
        status: 'VALID',
        message: 'Surat Valid',
      };
    }

    return {
      valid: false,
      status: 'INVALID',
      message: 'Surat tidak valid',
    };
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
        status: 'FAKE_OR_NOT_FOUND',
        message: 'Surat Palsu/Tidak ada',
        serverCheck: {
          pass: false,
          status: 'metadata_error',
          reason: error.message,
        },
        cryptoCheck: {
          pass: false,
          reason: 'Canonical payload is not available for cryptographic verification',
          keyStatus: null,
        },
        letter: null,
      };
    }

    const serverResult = await this.runServerCheck(metadata);
    const cryptoResult = await this.runCryptoCheck(metadata, serverResult.issuedLetter);
    const decision = this.decideVerificationResult(serverResult, cryptoResult);

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
}

export default new VerificationService();
