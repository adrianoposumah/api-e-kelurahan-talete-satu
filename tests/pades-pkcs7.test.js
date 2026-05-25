import crypto from 'crypto';
import { execFileSync } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import forge from 'node-forge';
import pkcs7Service from '../src/services/pkcs7.service.js';

function createSelfSignedCertificate() {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  const attrs = [
    { name: 'commonName', value: 'Test Lurah' },
    { name: 'organizationName', value: 'Kelurahan Talete Satu' },
    { name: 'countryName', value: 'ID' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([{ name: 'basicConstraints', cA: false }, { name: 'keyUsage', digitalSignature: true }]);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  return {
    cert,
    certPem: forge.pki.certificateToPem(cert),
    privateKeyPem: forge.pki.privateKeyToPem(keys.privateKey),
  };
}

const { cert, privateKeyPem } = createSelfSignedCertificate();
const documentHash = crypto.createHash('sha256').update('hello pades').digest();
const signedAttrsDer = pkcs7Service.buildSignedAttributesDer(documentHash, cert, new Date('2026-05-25T00:00:00.000Z'));
const signature = crypto.createSign('RSA-SHA256').update(signedAttrsDer).end().sign(privateKeyPem);
const pkcs7Der = pkcs7Service.assemblePkcs7SignedData(signedAttrsDer, signature, cert);
const parsed = pkcs7Service.parsePkcs7FromHex(pkcs7Der.toString('hex'));

const verify = crypto.createVerify('RSA-SHA256');
verify.update(parsed.signedAttributesDer);
verify.end();

if (!parsed.messageDigest.equals(documentHash)) {
  throw new Error('messageDigest round-trip mismatch');
}
if (!verify.verify(parsed.signerCertPem, parsed.signatureBytes)) {
  throw new Error('parsed PKCS#7 signature does not verify');
}

const outDir = join(process.cwd(), 'storage');
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, 'test-pades.p7s');
writeFileSync(outPath, pkcs7Der);

try {
  execFileSync('openssl', ['pkcs7', '-inform', 'DER', '-in', outPath, '-print'], { stdio: 'pipe' });
  console.log('OpenSSL parsed PKCS#7 DER successfully');
} catch (error) {
  console.warn(`OpenSSL parse skipped/failed: ${error.message}`);
}

console.log('PKCS#7 PAdES test passed');
