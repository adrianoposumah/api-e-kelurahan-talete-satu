import crypto from 'crypto';
import forge from 'node-forge';
import prisma from '../config/prisma.js';
import { sendToUser } from './notification.service.js';

/**
 * Crypto Service - PAdES/mobile-key verification and public key management.
 *
 * Server-side private-key generation/signing was removed in v2.0. New Lurah
 * keys are enrolled from mobile CSR and only public key + certificate data are
 * stored on the server.
 */
class CryptoService {
  verifySignatureWithCertificate(bytesToSign, signature, certificatePem) {
    try {
      const cert = forge.pki.certificateFromPem(certificatePem);
      const publicKeyPem = forge.pki.publicKeyToPem(cert.publicKey);
      const signatureBuffer = Buffer.isBuffer(signature) ? signature : Buffer.from(signature, 'base64');
      const verifier = crypto.createVerify('RSA-SHA256');
      verifier.update(Buffer.isBuffer(bytesToSign) ? bytesToSign : Buffer.from(bytesToSign, 'utf8'));
      verifier.end();
      return verifier.verify(publicKeyPem, signatureBuffer);
    } catch {
      return false;
    }
  }

  verifyCertChain(leafCertPem, rootCaCertPem) {
    try {
      const leaf = forge.pki.certificateFromPem(leafCertPem);
      const root = forge.pki.certificateFromPem(rootCaCertPem);
      forge.pki.verifyCertificateChain(forge.pki.createCaStore([root]), [leaf]);
      const now = new Date();
      return leaf.validity.notBefore <= now && leaf.validity.notAfter >= now;
    } catch {
      return false;
    }
  }

  computeCertFingerprint(certificatePem) {
    const cert = forge.pki.certificateFromPem(certificatePem);
    const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
    return crypto.createHash('sha256').update(Buffer.from(der, 'binary')).digest('hex');
  }

  hashData(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
  }

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
        certificatePem: true,
        fingerprint: true,
        algorithm: true,
        status: true,
        deactivatedAt: true,
        deactivateReason: true,
        createdAt: true,
        lurahProfile: {
          select: { userId: true, namaLengkap: true },
        },
      },
    });

    sendToUser(updatedKey.lurahProfile.userId, {
      title: 'Kunci Digital Dicabut',
      body: reason ? `Kunci digital Anda telah dicabut. Alasan: ${reason}` : 'Kunci digital Anda telah dicabut oleh administrator.',
      type: 'other',
      data: {
        info: 'key_revoked',
        key_id: updatedKey.id.toString(),
        fingerprint: updatedKey.fingerprint ?? '',
        revoked_at: updatedKey.deactivatedAt?.toISOString() ?? '',
      },
    }).catch((err) => {
      console.error('Gagal mengirim notifikasi pencabutan kunci:', err);
    });

    return {
      id: updatedKey.id.toString(),
      publicKey: updatedKey.publicKey,
      certificatePem: updatedKey.certificatePem,
      fingerprint: updatedKey.fingerprint,
      algorithm: updatedKey.algorithm,
      status: updatedKey.status,
      deactivatedAt: updatedKey.deactivatedAt,
      deactivateReason: updatedKey.deactivateReason,
      createdAt: updatedKey.createdAt,
    };
  }

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

  async getActivePublicKey() {
    return prisma.lurahKey.findFirst({
      where: {
        status: 'ACTIVE',
        certificatePem: { not: null },
        expiresAt: { gt: new Date() },
      },
      select: {
        id: true,
        publicKey: true,
        certificatePem: true,
        fingerprint: true,
        algorithm: true,
        status: true,
        createdAt: true,
        expiresAt: true,
        lurahProfile: {
          select: {
            namaLengkap: true,
            nip: true,
            jabatan: true,
          },
        },
      },
    });
  }

  async getAllPublicKeys() {
    return prisma.lurahKey.findMany({
      select: {
        id: true,
        publicKey: true,
        certificatePem: true,
        fingerprint: true,
        serialNumber: true,
        deviceLabel: true,
        algorithm: true,
        status: true,
        createdAt: true,
        enrolledAt: true,
        expiresAt: true,
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
  }

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

    return prisma.lurahKey.findFirst({
      where: {
        lurahProfileId: lurahProfile.id,
        status: 'ACTIVE',
        certificatePem: { not: null },
        expiresAt: { gt: new Date() },
      },
      select: {
        id: true,
        publicKey: true,
        certificatePem: true,
        fingerprint: true,
        algorithm: true,
        status: true,
        createdAt: true,
        expiresAt: true,
      },
    });
  }
}

export default new CryptoService();
