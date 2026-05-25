import crypto from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import forge from 'node-forge';
import env from '../config/env.js';

const ROOT_CA_SUBJECT = {
  commonName: 'Kelurahan Talete Satu Root CA',
  organizationName: 'Kelurahan Talete Satu',
  organizationalUnitName: 'Pemerintah Kota Tomohon',
  countryName: 'ID',
};

const ROOT_CA_VALIDITY_YEARS = 10;
const LURAH_CERT_VALIDITY_YEARS = 3;

let cachedRootCa = null;

function resolveProjectPath(pathValue) {
  return resolve(process.cwd(), pathValue);
}

function generateSerialNumber() {
  const hex = crypto.randomBytes(16).toString('hex');
  return /^[89a-f]/i.test(hex) ? `00${hex}` : hex;
}

function subjectObjectToAttrs(subject) {
  return [
    { name: 'commonName', value: subject.commonName },
    { name: 'organizationName', value: subject.organizationName },
    { name: 'organizationalUnitName', value: subject.organizationalUnitName },
    { name: 'countryName', value: subject.countryName },
  ];
}

function computeCertFingerprint(certificatePem) {
  const cert = forge.pki.certificateFromPem(certificatePem);
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  return crypto.createHash('sha256').update(Buffer.from(der, 'binary')).digest('hex');
}

function validateSubjectMatch(csrAttrs, expected) {
  const findValue = (name) => csrAttrs.find((attr) => attr.name === name || attr.shortName === name)?.value || null;
  const checks = [
    ['commonName', expected.commonName],
    ['organizationName', expected.organizationName],
    ['organizationalUnitName', expected.organizationalUnitName],
    ['countryName', expected.countryName],
  ];

  for (const [name, value] of checks) {
    const actual = findValue(name);
    if (actual !== value) {
      const error = new Error(`Subject CSR tidak match untuk ${name}: expected ${value}, got ${actual || '-'}`);
      error.code = 'SUBJECT_MISMATCH';
      throw error;
    }
  }
}

class CaService {
  getSubjectTemplate() {
    return {
      commonName: 'Lurah Talete Satu',
      organization: 'Kelurahan Talete Satu',
      organizationalUnit: 'Pemerintah Kota Tomohon',
      country: 'ID',
    };
  }

  getExpectedSubject() {
    const template = this.getSubjectTemplate();
    return {
      commonName: template.commonName,
      organizationName: template.organization,
      organizationalUnitName: template.organizationalUnit,
      countryName: template.country,
    };
  }

  bootstrapRootCa() {
    if (!env.ROOT_CA_KEY_PASSPHRASE) {
      throw new Error('ROOT_CA_KEY_PASSPHRASE belum di-set');
    }

    const certPath = resolveProjectPath(env.ROOT_CA_CERT_PATH);
    const keyPath = resolveProjectPath(env.ROOT_CA_KEY_PATH);

    if (existsSync(certPath) || existsSync(keyPath)) {
      throw new Error(`Root CA sudah ada: ${certPath}, ${keyPath}`);
    }

    const keypair = forge.pki.rsa.generateKeyPair({ bits: 4096, e: 0x10001 });
    const cert = forge.pki.createCertificate();
    cert.publicKey = keypair.publicKey;
    cert.serialNumber = generateSerialNumber();
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date();
    cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + ROOT_CA_VALIDITY_YEARS);

    const attrs = subjectObjectToAttrs(ROOT_CA_SUBJECT);
    cert.setSubject(attrs);
    cert.setIssuer(attrs);
    cert.setExtensions([
      { name: 'basicConstraints', cA: true, critical: true },
      { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
      { name: 'subjectKeyIdentifier' },
    ]);
    cert.sign(keypair.privateKey, forge.md.sha256.create());

    const certificatePem = forge.pki.certificateToPem(cert);
    const privateKeyPem = forge.pki.encryptRsaPrivateKey(keypair.privateKey, env.ROOT_CA_KEY_PASSPHRASE, { algorithm: 'aes256' });

    mkdirSync(dirname(certPath), { recursive: true, mode: 0o700 });
    writeFileSync(certPath, certificatePem, { mode: 0o644 });
    writeFileSync(keyPath, privateKeyPem, { mode: 0o600 });

    return { certificatePem, privateKeyPem };
  }

  loadRootCa() {
    if (cachedRootCa) return cachedRootCa;
    if (!env.ROOT_CA_KEY_PASSPHRASE) {
      throw new Error('ROOT_CA_KEY_PASSPHRASE belum di-set');
    }

    const certPath = resolveProjectPath(env.ROOT_CA_CERT_PATH);
    const keyPath = resolveProjectPath(env.ROOT_CA_KEY_PATH);
    if (!existsSync(certPath) || !existsSync(keyPath)) {
      throw new Error('Root CA belum tersedia. Jalankan scripts/bootstrap-root-ca.js terlebih dahulu.');
    }

    const certificatePem = readFileSync(certPath, 'utf8');
    const privateKeyPem = readFileSync(keyPath, 'utf8');
    const certificate = forge.pki.certificateFromPem(certificatePem);
    const privateKey = forge.pki.decryptRsaPrivateKey(privateKeyPem, env.ROOT_CA_KEY_PASSPHRASE);
    if (!privateKey) {
      throw new Error('Gagal membuka Root CA private key. Cek passphrase.');
    }

    cachedRootCa = { certificate, privateKey, certificatePem };
    return cachedRootCa;
  }

  signCsr(csrPem) {
    const csr = forge.pki.certificationRequestFromPem(csrPem);
    if (!csr.verify()) {
      const error = new Error('CSR signature tidak valid atau format malformed');
      error.code = 'INVALID_CSR';
      throw error;
    }

    validateSubjectMatch(csr.subject.attributes, this.getExpectedSubject());

    const rootCa = this.loadRootCa();
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt);
    expiresAt.setFullYear(expiresAt.getFullYear() + LURAH_CERT_VALIDITY_YEARS);

    const cert = forge.pki.createCertificate();
    cert.publicKey = csr.publicKey;
    cert.serialNumber = generateSerialNumber();
    cert.validity.notBefore = issuedAt;
    cert.validity.notAfter = expiresAt;
    cert.setSubject(csr.subject.attributes);
    cert.setIssuer(rootCa.certificate.subject.attributes);
    cert.setExtensions([
      { name: 'basicConstraints', cA: false, critical: true },
      { name: 'keyUsage', digitalSignature: true, nonRepudiation: true, critical: true },
      { name: 'extKeyUsage', clientAuth: true },
      { name: 'subjectKeyIdentifier' },
      { name: 'authorityKeyIdentifier', keyIdentifier: rootCa.certificate.generateSubjectKeyIdentifier().getBytes() },
    ]);
    cert.sign(rootCa.privateKey, forge.md.sha256.create());

    const certificatePem = forge.pki.certificateToPem(cert);
    return {
      certificatePem,
      publicKeyPem: forge.pki.publicKeyToPem(cert.publicKey),
      serialNumber: cert.serialNumber,
      fingerprint: computeCertFingerprint(certificatePem),
      issuedAt,
      expiresAt,
    };
  }

  getRootCaPem() {
    return this.loadRootCa().certificatePem;
  }

  computeCertFingerprint(certificatePem) {
    return computeCertFingerprint(certificatePem);
  }
}

export default new CaService();
export { ROOT_CA_SUBJECT };
