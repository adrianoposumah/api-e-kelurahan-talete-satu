import prisma from '../config/prisma.js';
import cryptoService from './crypto.service.js';
import pdfService from './pdf.service.js';

/**
 * Verification Service - Hybrid verification for uploaded letter PDF files.
 *
 * Validation is split into two independent checks:
 * 1) Server-based check against DB records.
 * 2) Cryptographic check against stored public key.
 */
class VerificationService {
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
        reason: 'Letter code not found in records',
        issuedLetter: null,
      };
    }

    if (!['approved', 'issued'].includes(issuedLetter.submission.status)) {
      return {
        pass: false,
        reason: 'Letter was not approved through the system',
        issuedLetter,
      };
    }

    if (issuedLetter.isRevoked) {
      return {
        pass: false,
        reason: `Letter has been revoked: ${issuedLetter.revokedReason || 'No reason provided'}`,
        issuedLetter,
      };
    }

    if (metadata.signatureValue !== issuedLetter.signature) {
      return {
        pass: false,
        reason: 'Signature does not match records',
        issuedLetter,
      };
    }

    if (metadata.canonicalHash && metadata.canonicalHash !== issuedLetter.canonicalHash) {
      return {
        pass: false,
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
          reason: 'Canonical payload in metadata is malformed',
          issuedLetter,
        };
      }

      if (decodedCanonicalPayload !== issuedLetter.canonicalData) {
        return {
          pass: false,
          reason: 'Canonical payload does not match records',
          issuedLetter,
        };
      }
    }

    if (metadata.signatureKeyId && issuedLetter.signatureKeyId && metadata.signatureKeyId !== issuedLetter.signatureKeyId.toString()) {
      return {
        pass: false,
        reason: 'Signing key does not match records',
        issuedLetter,
      };
    }

    if (metadata.letterNumber && metadata.letterNumber !== issuedLetter.letterNumber) {
      return {
        pass: false,
        reason: 'Letter number does not match records',
        issuedLetter,
      };
    }

    return {
      pass: true,
      reason: 'Letter found in records with approved status',
      issuedLetter,
    };
  }

  /**
   * Resolve key record used to verify a letter signature.
   * @param {object} metadata - Extracted metadata
   * @param {object} issuedLetter - Issued letter DB record
   * @returns {Promise<object|null>} Key record or null
   */
  async resolveKey(metadata, issuedLetter) {
    if (metadata.signatureKeyId) {
      return prisma.lurahKey.findUnique({ where: { id: BigInt(metadata.signatureKeyId) } });
    }

    if (issuedLetter.signatureKeyId) {
      return prisma.lurahKey.findUnique({ where: { id: issuedLetter.signatureKeyId } });
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
    if (!issuedLetter) {
      return {
        pass: false,
        reason: 'Server check failed — crypto check skipped',
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

    const isValid = cryptoService.verifyLetterSignature(issuedLetter.canonicalData, metadata.signatureValue, keyRecord.publicKey);

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
        serverCheck: {
          pass: false,
          reason: error.message,
        },
        cryptoCheck: {
          pass: false,
          reason: 'Server check failed — crypto check skipped',
          keyStatus: null,
        },
        letter: null,
      };
    }

    const serverResult = await this.runServerCheck(metadata);
    const cryptoResult = await this.runCryptoCheck(metadata, serverResult.pass ? serverResult.issuedLetter : null);
    const valid = serverResult.pass && cryptoResult.pass;

    return {
      valid,
      serverCheck: {
        pass: serverResult.pass,
        reason: serverResult.reason,
      },
      cryptoCheck: {
        pass: cryptoResult.pass,
        reason: cryptoResult.reason,
        keyStatus: cryptoResult.keyStatus,
      },
      letter: valid
        ? {
            letterNumber: serverResult.issuedLetter.letterNumber,
            letterType: serverResult.issuedLetter.type,
            issuedAt: serverResult.issuedLetter.issuedAt,
            formData: serverResult.issuedLetter.submission.payload || {},
          }
        : null,
    };
  }
}

export default new VerificationService();
