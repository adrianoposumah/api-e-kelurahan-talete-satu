import crypto from 'crypto';
import prisma from '../config/prisma.js';

/**
 * Crypto Service - Handles digital signatures and key management
 */
class CryptoService {
  constructor() {
    this.algorithm = 'RSA-SHA256';
    this.keySize = 2048;
  }

  /**
   * Generate a new RSA key pair
   * @returns {object} { publicKey, privateKey }
   */
  generateKeyPair() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: this.keySize,
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem',
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem',
      },
    });

    return { publicKey, privateKey };
  }

  /**
   * Encrypt private key for storage
   * @param {string} privateKey - Private key PEM
   * @param {string} passphrase - Encryption passphrase
   * @returns {string} Encrypted private key
   */
  encryptPrivateKey(privateKey, passphrase) {
    const algorithm = 'aes-256-gcm';
    const key = crypto.scryptSync(passphrase, 'salt', 32);
    const iv = crypto.randomBytes(16);

    const cipher = crypto.createCipheriv(algorithm, key, iv);
    let encrypted = cipher.update(privateKey, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return JSON.stringify({
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
      data: encrypted,
    });
  }

  /**
   * Decrypt private key
   * @param {string} encryptedData - Encrypted private key JSON
   * @param {string} passphrase - Decryption passphrase
   * @returns {string} Decrypted private key PEM
   */
  decryptPrivateKey(encryptedData, passphrase) {
    const algorithm = 'aes-256-gcm';
    const key = crypto.scryptSync(passphrase, 'salt', 32);

    const { iv, authTag, data } = JSON.parse(encryptedData);

    const decipher = crypto.createDecipheriv(algorithm, key, Buffer.from(iv, 'hex'));
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));

    let decrypted = decipher.update(data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * Set or update key pair for a Lurah
   * @param {string} lurahUserId - Lurah user ID
   * @param {string} passphrase - Passphrase for encrypting private key
   * @returns {Promise<object>} Created/updated key record
   */
  async setLurahKeyPair(lurahUserId, passphrase) {
    // Verify user is a lurah with active profile
    const lurahProfile = await prisma.lurahProfile.findFirst({
      where: {
        userId: BigInt(lurahUserId),
        isActive: true,
      },
      include: { user: true },
    });

    if (!lurahProfile) {
      const error = new Error('Lurah profile tidak ditemukan atau tidak aktif');
      error.code = 'NOT_FOUND';
      throw error;
    }

    if (lurahProfile.user.role !== 'lurah') {
      const error = new Error('User bukan Lurah');
      error.code = 'FORBIDDEN';
      throw error;
    }

    // Generate new key pair
    const { publicKey, privateKey } = this.generateKeyPair();

    // Encrypt private key
    const encryptedPrivateKey = this.encryptPrivateKey(privateKey, passphrase);

    // Deactivate existing keys for this profile
    await prisma.lurahKey.updateMany({
      where: { lurahProfileId: lurahProfile.id },
      data: { isActive: false },
    });

    // Create new key record
    const keyRecord = await prisma.lurahKey.create({
      data: {
        lurahProfileId: lurahProfile.id,
        publicKey,
        privateKey: encryptedPrivateKey,
        algorithm: this.algorithm,
        isActive: true,
      },
    });

    return {
      id: keyRecord.id.toString(),
      publicKey,
      algorithm: keyRecord.algorithm,
      createdAt: keyRecord.createdAt,
    };
  }

  /**
   * Get active key for a Lurah profile
   * @param {string} lurahProfileId - Lurah profile ID
   * @returns {Promise<object>} Key record
   */
  async getLurahKey(lurahProfileId) {
    const keyRecord = await prisma.lurahKey.findFirst({
      where: {
        lurahProfileId: BigInt(lurahProfileId),
        isActive: true,
      },
    });

    if (!keyRecord) {
      const error = new Error('Lurah belum memiliki key pair yang aktif');
      error.code = 'NOT_FOUND';
      throw error;
    }

    return keyRecord;
  }

  /**
   * Get any active Lurah key with profile info
   * @returns {Promise<object>} Key record with lurah profile info
   */
  async getActiveLurahKey() {
    const keyRecord = await prisma.lurahKey.findFirst({
      where: { isActive: true },
      include: {
        lurahProfile: {
          include: {
            user: {
              include: { kependudukan: true },
            },
          },
        },
      },
    });

    if (!keyRecord) {
      const error = new Error('Tidak ada key pair Lurah yang aktif');
      error.code = 'NOT_FOUND';
      throw error;
    }

    return { keyRecord, lurahProfile: keyRecord.lurahProfile };
  }

  /**
   * Build canonical data string from letter data
   * @param {object} data - Letter data
   * @returns {string} Canonical string
   */
  buildCanonicalData(data) {
    // Create deterministic canonical string
    const fields = [
      `nama=${data.nama}`,
      `nik=${data.nik}`,
      `jenis_kelamin=${data.jenisKelamin}`,
      `lingkungan=${data.lingkungan}`,
      `nomor_surat=${data.nomorSurat}`,
      `type=${data.type}`,
      `tanggal=${data.tanggal}`,
      `issued_by=${data.issuedBy}`,
    ];

    return fields.join('\n');
  }

  /**
   * Hash data using SHA-256
   * @param {string} data - Data to hash
   * @returns {string} Hex-encoded hash
   */
  hashData(data) {
    return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
  }

  /**
   * Sign data with private key
   * @param {string} data - Data to sign
   * @param {string} privateKeyPem - Private key in PEM format
   * @returns {string} Base64-encoded signature
   */
  signData(data, privateKeyPem) {
    const sign = crypto.createSign('SHA256');
    sign.update(data);
    sign.end();

    const signature = sign.sign(privateKeyPem, 'base64');
    return signature;
  }

  /**
   * Verify signature
   * @param {string} data - Original data
   * @param {string} signature - Base64-encoded signature
   * @param {string} publicKeyPem - Public key in PEM format
   * @returns {boolean} Verification result
   */
  verifySignature(data, signature, publicKeyPem) {
    try {
      const verify = crypto.createVerify('SHA256');
      verify.update(data);
      verify.end();

      return verify.verify(publicKeyPem, signature, 'base64');
    } catch {
      return false;
    }
  }

  /**
   * Create digital signature for a letter
   * @param {object} letterData - Letter data to sign
   * @param {string} lurahProfileId - Lurah profile ID
   * @param {string} passphrase - Passphrase for private key
   * @returns {Promise<object>} Signature data
   */
  async createLetterSignature(letterData, lurahProfileId, passphrase) {
    // Get lurah's key
    const keyRecord = await this.getLurahKey(lurahProfileId);

    // Decrypt private key
    const privateKey = this.decryptPrivateKey(keyRecord.privateKey, passphrase);

    // Build canonical data
    const canonicalData = this.buildCanonicalData(letterData);

    // Hash canonical data
    const canonicalHash = this.hashData(canonicalData);

    // Sign the hash
    const signature = this.signData(canonicalData, privateKey);

    return {
      canonicalData,
      canonicalHash,
      signature,
      algorithm: keyRecord.algorithm,
      signedBy: lurahProfileId,
    };
  }

  /**
   * Verify a letter's signature
   * @param {string} canonicalData - Original canonical data
   * @param {string} signature - Base64-encoded signature
   * @param {string} publicKey - Public key PEM
   * @returns {boolean} Verification result
   */
  verifyLetterSignature(canonicalData, signature, publicKey) {
    return this.verifySignature(canonicalData, signature, publicKey);
  }

  /**
   * Get Lurah key by user ID
   * @param {string} userId - User ID
   * @returns {Promise<object|null>} Key record or null
   */
  async getLurahKeyByUserId(userId) {
    const lurahProfile = await prisma.lurahProfile.findFirst({
      where: {
        userId: BigInt(userId),
        isActive: true,
      },
    });

    if (!lurahProfile) {
      const error = new Error('Lurah profile tidak ditemukan');
      error.code = 'NOT_FOUND';
      throw error;
    }

    const keyRecord = await prisma.lurahKey.findFirst({
      where: {
        lurahProfileId: lurahProfile.id,
        isActive: true,
      },
    });

    return keyRecord;
  }

  /**
   * Revoke Lurah's active key
   * @param {string} userId - User ID
   * @returns {Promise<void>}
   */
  async revokeLurahKey(userId) {
    const lurahProfile = await prisma.lurahProfile.findFirst({
      where: {
        userId: BigInt(userId),
        isActive: true,
      },
    });

    if (!lurahProfile) {
      const error = new Error('Lurah profile tidak ditemukan');
      error.code = 'NOT_FOUND';
      throw error;
    }

    const result = await prisma.lurahKey.updateMany({
      where: {
        lurahProfileId: lurahProfile.id,
        isActive: true,
      },
      data: { isActive: false },
    });

    if (result.count === 0) {
      const error = new Error('Tidak ada key aktif untuk dinonaktifkan');
      error.code = 'NOT_FOUND';
      throw error;
    }
  }
}

export default new CryptoService();
