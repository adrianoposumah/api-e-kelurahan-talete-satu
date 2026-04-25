import crypto from 'crypto';
import prisma from '../config/prisma.js';

/**
 * Crypto Service - Handles digital signatures and key management
 * RSA-4096 with SHA-256, AES-256-GCM for private key encryption
 */
class CryptoService {
  constructor() {
    this.algorithm = 'RSA-SHA256';
    this.keySize = 4096;
  }

  // ==================== CORE CRYPTOGRAPHIC FUNCTIONS ====================

  /**
   * Generate a new RSA-4096 key pair
   * @returns {object} { publicKey, privateKey } as PEM strings
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
   * Encrypt private key with AES-256-GCM using passphrase
   * Uses scrypt with random 32-byte salt for key derivation
   * @param {string} privateKeyPem - Private key PEM string
   * @param {string} passphrase - Encryption passphrase
   * @returns {string} Encrypted blob: base64(salt):base64(iv):base64(authTag):base64(ciphertext)
   */
  encryptPrivateKey(privateKeyPem, passphrase) {
    const salt = crypto.randomBytes(32);
    const key = crypto.scryptSync(passphrase, salt, 32);
    const iv = crypto.randomBytes(12);

    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let encrypted = cipher.update(privateKeyPem, 'utf8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);

    const authTag = cipher.getAuthTag();

    return `${salt.toString('base64')}:${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
  }

  /**
   * Decrypt private key from encrypted blob
   * @param {string} encryptedBlob - Format: base64(salt):base64(iv):base64(authTag):base64(ciphertext)
   * @param {string} passphrase - Decryption passphrase
   * @returns {string} Decrypted private key PEM string
   * @throws {Error} "Invalid passphrase" if GCM auth fails
   */
  decryptPrivateKey(encryptedBlob, passphrase) {
    try {
      const [saltB64, ivB64, authTagB64, ciphertextB64] = encryptedBlob.split(':');

      const salt = Buffer.from(saltB64, 'base64');
      const iv = Buffer.from(ivB64, 'base64');
      const authTag = Buffer.from(authTagB64, 'base64');
      const ciphertext = Buffer.from(ciphertextB64, 'base64');

      const key = crypto.scryptSync(passphrase, salt, 32);

      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(ciphertext, null, 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch {
      throw new Error('Invalid passphrase');
    }
  }

  /**
   * Sign data with private key using SHA256withRSA
   * @param {string} canonicalString - Data to sign
   * @param {string} privateKeyPem - Private key PEM
   * @returns {string} Base64-encoded signature
   */
  signData(canonicalString, privateKeyPem) {
    const sign = crypto.createSign('SHA256');
    sign.update(canonicalString);
    sign.end();

    return sign.sign(privateKeyPem, 'base64');
  }

  /**
   * Verify signature
   * @param {string} canonicalString - Original data
   * @param {string} signatureBase64 - Base64-encoded signature
   * @param {string} publicKeyPem - Public key PEM
   * @returns {boolean} true if valid, false otherwise — never throws
   */
  verifySignature(canonicalString, signatureBase64, publicKeyPem) {
    try {
      const verify = crypto.createVerify('SHA256');
      verify.update(canonicalString);
      verify.end();

      return verify.verify(publicKeyPem, signatureBase64, 'base64');
    } catch {
      return false;
    }
  }

  // ==================== KEY MANAGEMENT ====================

  /**
   * Generate a new key pair for a Lurah
   * @param {string} lurahUserId - Lurah user ID
   * @param {string} passphrase - Passphrase to encrypt private key
   * @returns {Promise<object>} Key record (without encryptedPrivateKey)
   */
  async generateLurahKey(lurahUserId, passphrase) {
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

    // Guard: no other ACTIVE key must exist
    const existingActiveKey = await prisma.lurahKey.findFirst({
      where: { status: 'ACTIVE' },
    });

    if (existingActiveKey) {
      const error = new Error('Sudah ada key aktif. Nonaktifkan key yang ada terlebih dahulu sebelum membuat key baru');
      error.code = 'BAD_REQUEST';
      throw error;
    }

    // Generate RSA-4096 key pair
    const { publicKey, privateKey } = this.generateKeyPair();

    // Encrypt private key with passphrase
    const encryptedPrivateKey = this.encryptPrivateKey(privateKey, passphrase);

    // Create new key record
    const keyRecord = await prisma.lurahKey.create({
      data: {
        lurahProfileId: lurahProfile.id,
        publicKey,
        encryptedPrivateKey,
        algorithm: this.algorithm,
        status: 'ACTIVE',
      },
      select: {
        id: true,
        publicKey: true,
        algorithm: true,
        status: true,
        createdAt: true,
      },
    });

    return {
      id: keyRecord.id.toString(),
      publicKey: keyRecord.publicKey,
      algorithm: keyRecord.algorithm,
      status: keyRecord.status,
      createdAt: keyRecord.createdAt,
    };
  }

  /**
   * Revoke a key (admin-only)
   * @param {string} keyId - LurahKey ID
   * @param {string} adminUserId - Admin user ID who is revoking
   * @param {string} reason - Reason for revocation
   * @returns {Promise<object>} Updated key record (without encryptedPrivateKey)
   */
  async revokeKey(keyId, adminUserId, reason) {
    const keyRecord = await prisma.lurahKey.findUnique({
      where: { id: BigInt(keyId) },
    });

    if (!keyRecord) {
      const error = new Error('Key tidak ditemukan');
      error.code = 'NOT_FOUND';
      throw error;
    }

    if (keyRecord.status !== 'ACTIVE') {
      const error = new Error(`Key tidak dapat direvoke, status saat ini: ${keyRecord.status}`);
      error.code = 'BAD_REQUEST';
      throw error;
    }

    const updatedKey = await prisma.lurahKey.update({
      where: { id: BigInt(keyId) },
      data: {
        status: 'REVOKED',
        deactivatedAt: new Date(),
        deactivatedById: BigInt(adminUserId),
        deactivateReason: reason,
      },
      select: {
        id: true,
        publicKey: true,
        algorithm: true,
        status: true,
        deactivatedAt: true,
        deactivateReason: true,
        createdAt: true,
      },
    });

    return {
      id: updatedKey.id.toString(),
      publicKey: updatedKey.publicKey,
      algorithm: updatedKey.algorithm,
      status: updatedKey.status,
      deactivatedAt: updatedKey.deactivatedAt,
      deactivateReason: updatedKey.deactivateReason,
      createdAt: updatedKey.createdAt,
    };
  }

  /**
   * Deactivate all ACTIVE keys for a lurah profile (called during demotion)
   * @param {BigInt} lurahProfileId - Lurah profile ID
   * @param {string} adminUserId - Admin user ID
   */
  async deactivateKeysForUser(lurahProfileId, adminUserId) {
    await prisma.lurahKey.updateMany({
      where: {
        lurahProfileId: BigInt(lurahProfileId),
        status: 'ACTIVE',
      },
      data: {
        status: 'INACTIVE',
        deactivatedAt: new Date(),
        deactivatedById: BigInt(adminUserId),
      },
    });
  }

  /**
   * Get current active public key
   * @returns {Promise<object|null>} { id, publicKey } or null if none
   */
  async getActivePublicKey() {
    const keyRecord = await prisma.lurahKey.findFirst({
      where: { status: 'ACTIVE' },
      select: {
        id: true,
        publicKey: true,
        algorithm: true,
        status: true,
        createdAt: true,
        lurahProfile: {
          select: {
            namaLengkap: true,
            nip: true,
            jabatan: true,
          },
        },
      },
    });

    return keyRecord;
  }

  /**
   * Get all public keys (for verification of historical letters)
   * Never includes encryptedPrivateKey
   * @returns {Promise<object[]>} All key records
   */
  async getAllPublicKeys() {
    const keys = await prisma.lurahKey.findMany({
      select: {
        id: true,
        publicKey: true,
        algorithm: true,
        status: true,
        createdAt: true,
        deactivatedAt: true,
        deactivateReason: true,
        lurahProfile: {
          select: {
            namaLengkap: true,
            nip: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return keys;
  }

  // ==================== KEY LOOKUP (Internal) ====================

  /**
   * Get active key for a Lurah profile (internal use for signing)
   * @param {string} lurahProfileId - Lurah profile ID
   * @returns {Promise<object>} Key record including encryptedPrivateKey (for signing)
   */
  async getLurahKey(lurahProfileId) {
    const keyRecord = await prisma.lurahKey.findFirst({
      where: {
        lurahProfileId: BigInt(lurahProfileId),
        status: 'ACTIVE',
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
      where: { status: 'ACTIVE' },
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
        status: 'ACTIVE',
      },
      select: {
        id: true,
        publicKey: true,
        algorithm: true,
        status: true,
        createdAt: true,
      },
    });

    return keyRecord;
  }

  // ==================== CANONICAL DATA & SIGNING ====================

  /**
   * Build canonical data in deterministic JSON format.
   * Fields are defined in a fixed order to ensure deterministic output.
   * @param {object} letterData - Letter data
   * @param {object} issuerData - Issuer (Lurah) data
   * @param {object} metadata - Additional metadata
   * @returns {string} Canonical data JSON string
   */
  buildCanonicalData(letterData, issuerData, metadata) {
    // Fixed-order canonical structure — order matters for determinism
    const canonical = {
      version: '1.0',
      type: letterData.type,
      nomor_surat: letterData.nomorSurat,
      nama: letterData.nama,
      nik: letterData.nik,
      tanggal_lahir: letterData.tanggalLahir || null,
      lingkungan: letterData.lingkungan,
      tujuan: letterData.tujuan || null,
      issued_date: metadata.issuedDate,
      issuer: {
        nama_lurah: issuerData.namaLurah,
        nip_lurah: issuerData.nipLurah,
        kelurahan: issuerData.kelurahan || 'Talete Satu',
        kecamatan: issuerData.kecamatan || 'Tomohon Tengah',
        kota: issuerData.kota || 'Tomohon',
      },
      verification_code: metadata.verificationCode,
      algorithm: 'SHA256withRSA',
      public_key_fingerprint: metadata.publicKeyFingerprint,
    };

    // Use JSON.stringify without replacer — keys already in deterministic order
    return JSON.stringify(canonical);
  }

  /**
   * Hash canonical data using SHA-256 (stored in DB for audit/verification display)
   * @param {string} canonicalData - Canonical data string
   * @returns {string} Hex-encoded hash digest
   */
  hashCanonicalData(canonicalData) {
    return crypto.createHash('sha256').update(canonicalData, 'utf8').digest('hex');
  }

  /**
   * Generate public key fingerprint (SHA-256 of public key)
   * @param {string} publicKeyPem - Public key in PEM format
   * @returns {string} Colon-separated hex fingerprint
   */
  generatePublicKeyFingerprint(publicKeyPem) {
    const hash = crypto.createHash('sha256').update(publicKeyPem, 'utf8').digest('hex');
    return hash.match(/.{2}/g).join(':').toUpperCase();
  }

  /**
   * Create digital signature for a letter.
   * Signs the canonical string directly with signData() — crypto.createSign('SHA256')
   * internally hashes with SHA-256 before RSA signing.
   * The canonicalHash is computed separately for DB storage/audit only.
   *
   * @param {object} letterData - Letter data fields
   * @param {object} issuerData - Issuer (Lurah) data
   * @param {object} metadata - Metadata (verificationCode, issuedDate)
   * @param {object} keyRecord - LurahKey record (with encryptedPrivateKey, publicKey, id)
   * @param {string} passphrase - Passphrase to decrypt private key
   * @returns {Promise<object>} Signature artifacts
   */
  async createLetterSignature(letterData, issuerData, metadata, keyRecord, passphrase) {
    // Step 1: Decrypt private key using passphrase
    let privateKey;
    try {
      privateKey = this.decryptPrivateKey(keyRecord.encryptedPrivateKey, passphrase);
    } catch {
      const error = new Error('Passphrase tidak valid');
      error.code = 'BAD_REQUEST';
      throw error;
    }

    // Step 2: Generate public key fingerprint
    const publicKeyFingerprint = this.generatePublicKeyFingerprint(keyRecord.publicKey);

    const enrichedMetadata = {
      ...metadata,
      publicKeyFingerprint,
    };

    // Step 3: Build canonical data (deterministic JSON)
    const canonicalData = this.buildCanonicalData(letterData, issuerData, enrichedMetadata);

    // Step 4: Sign canonical data directly with RSA-SHA256
    // signData() calls crypto.createSign('SHA256') which internally hashes before signing
    const signature = this.signData(canonicalData, privateKey);

    // Step 5: Compute hash for DB storage / audit display only
    const canonicalHash = this.hashCanonicalData(canonicalData);

    // Immediately discard private key from memory
    privateKey = null;

    // Step 6: Return signature artifacts
    return {
      canonicalData,
      canonicalHash,
      signature,
      algorithm: 'SHA256withRSA',
      publicKeyFingerprint,
      signatureKeyId: keyRecord.id.toString(),
    };
  }

  /**
   * Verify a letter's digital signature.
   * Uses signData/verifySignature pair — both operate on the canonical string directly.
   * @param {string} canonicalData - Original canonical data string
   * @param {string} signature - Base64-encoded RSA signature
   * @param {string} publicKey - Public key PEM
   * @returns {boolean} true if valid, false otherwise
   */
  verifyLetterSignature(canonicalData, signature, publicKey) {
    return this.verifySignature(canonicalData, signature, publicKey);
  }
}

export default new CryptoService();
