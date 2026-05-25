import crypto from 'crypto';
import forge from 'node-forge';

const { asn1, pki, util } = forge;

const OIDS = {
  data: '1.2.840.113549.1.7.1',
  signedData: '1.2.840.113549.1.7.2',
  contentType: '1.2.840.113549.1.9.3',
  messageDigest: '1.2.840.113549.1.9.4',
  signingTime: '1.2.840.113549.1.9.5',
  signingCertificateV2: '1.2.840.113549.1.9.16.2.47',
  sha256: '2.16.840.1.101.3.4.2.1',
  rsaEncryption: '1.2.840.113549.1.1.1',
};

function derBytes(node) {
  return asn1.toDer(node).getBytes();
}

function oidNode(oid) {
  return asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(oid).getBytes());
}

function nullNode() {
  return asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, '');
}

function integerNode(number) {
  return asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, asn1.integerToDer(number).getBytes());
}

function positiveIntegerFromHex(hex) {
  let normalized = String(hex || '').replace(/^0x/i, '');
  if (normalized.length % 2 !== 0) normalized = `0${normalized}`;
  if (!normalized) normalized = '00';
  if (parseInt(normalized.slice(0, 2), 16) >= 0x80) {
    normalized = `00${normalized}`;
  }
  return asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, util.hexToBytes(normalized));
}

function algorithmIdentifier(oid) {
  return asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [oidNode(oid), nullNode()]);
}

function buildAttribute(oid, valueNode) {
  return asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    oidNode(oid),
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, [valueNode]),
  ]);
}

function certDerBuffer(certObj) {
  return Buffer.from(derBytes(pki.certificateToAsn1(certObj)), 'binary');
}

function buildSigningCertificateV2(certObj) {
  const certHash = crypto.createHash('sha256').update(certDerBuffer(certObj)).digest();
  const essCertIdV2 = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, certHash.toString('binary')),
  ]);
  const signingCertV2 = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [essCertIdV2]),
  ]);
  return buildAttribute(OIDS.signingCertificateV2, signingCertV2);
}

function asBinary(buffer) {
  return Buffer.from(buffer).toString('binary');
}

function certCommonName(certPem) {
  try {
    const cert = pki.certificateFromPem(certPem);
    return cert.subject.getField('CN')?.value || null;
  } catch {
    return null;
  }
}

class Pkcs7Service {
  buildSignedAttributesDer(documentHash, signerCertObj, signingTime = new Date()) {
    const hashBuffer = Buffer.from(documentHash);
    if (hashBuffer.length !== 32) {
      throw new Error('documentHash must be a 32-byte SHA-256 Buffer');
    }

    const attributes = [
      buildAttribute(OIDS.contentType, oidNode(OIDS.data)),
      buildAttribute(OIDS.messageDigest, asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, asBinary(hashBuffer))),
      buildAttribute(OIDS.signingTime, asn1.create(asn1.Class.UNIVERSAL, asn1.Type.UTCTIME, false, asn1.dateToUtcTime(signingTime))),
      buildSigningCertificateV2(signerCertObj),
    ];

    const signedAttrsSet = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, attributes);
    return Buffer.from(derBytes(signedAttrsSet), 'binary');
  }

  assemblePkcs7SignedData(signedAttrsDer, signatureBuffer, signerCertObjOrPem) {
    const signerCertObj = typeof signerCertObjOrPem === 'string' ? pki.certificateFromPem(signerCertObjOrPem) : signerCertObjOrPem;
    const signedAttrsSet = asn1.fromDer(util.createBuffer(Buffer.from(signedAttrsDer).toString('binary')));
    const signedAttrsImplicit = asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, signedAttrsSet.value);
    const sha256AlgoId = algorithmIdentifier(OIDS.sha256);
    const rsaAlgoId = algorithmIdentifier(OIDS.rsaEncryption);

    const issuerAndSerial = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      pki.distinguishedNameToAsn1({ attributes: signerCertObj.issuer.attributes }),
      positiveIntegerFromHex(signerCertObj.serialNumber),
    ]);

    const signerInfo = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      integerNode(1),
      issuerAndSerial,
      sha256AlgoId,
      signedAttrsImplicit,
      rsaAlgoId,
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, asBinary(signatureBuffer)),
    ]);

    const signedData = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      integerNode(1),
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, [sha256AlgoId]),
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [oidNode(OIDS.data)]),
      asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [pki.certificateToAsn1(signerCertObj)]),
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, [signerInfo]),
    ]);

    const contentInfo = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      oidNode(OIDS.signedData),
      asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [signedData]),
    ]);

    return Buffer.from(derBytes(contentInfo), 'binary');
  }

  parsePkcs7FromHex(hexString) {
    const cleanHex = String(hexString || '').replace(/[^0-9a-f]/gi, '');
    const root = asn1.fromDer(util.createBuffer(Buffer.from(cleanHex, 'hex').toString('binary')));
    const signedData = root.value[1]?.value?.[0];
    if (!signedData) throw new Error('Invalid PKCS#7 ContentInfo');

    const certificatesNode = signedData.value.find((node) => node.tagClass === asn1.Class.CONTEXT_SPECIFIC && node.type === 0);
    const setNodes = signedData.value.filter((node) => node.tagClass === asn1.Class.UNIVERSAL && node.type === asn1.Type.SET);
    const signerInfos = setNodes[setNodes.length - 1];
    const signerInfo = signerInfos?.value?.[0];
    if (!certificatesNode?.value?.[0] || !signerInfo) throw new Error('PKCS#7 missing certificate or SignerInfo');

    const signerCertObj = pki.certificateFromAsn1(certificatesNode.value[0]);
    const signerCertPem = pki.certificateToPem(signerCertObj);
    const signedAttrsImplicit = signerInfo.value.find((node) => node.tagClass === asn1.Class.CONTEXT_SPECIFIC && node.type === 0);
    const signatureNode = signerInfo.value[signerInfo.value.length - 1];
    if (!signedAttrsImplicit || signatureNode.type !== asn1.Type.OCTETSTRING) throw new Error('PKCS#7 SignerInfo malformed');

    const signedAttrsSet = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, signedAttrsImplicit.value);
    const signedAttributesDer = Buffer.from(derBytes(signedAttrsSet), 'binary');

    let messageDigest = null;
    let signingTime = null;
    for (const attr of signedAttrsImplicit.value) {
      const oid = asn1.derToOid(attr.value[0].value);
      const valueNode = attr.value[1]?.value?.[0];
      if (oid === OIDS.messageDigest) {
        messageDigest = Buffer.from(valueNode.value, 'binary');
      }
      if (oid === OIDS.signingTime) {
        signingTime = asn1.utcTimeToDate(valueNode.value);
      }
    }

    if (!messageDigest) throw new Error('PKCS#7 missing messageDigest signed attribute');

    return {
      signedAttributesDer,
      signatureBytes: Buffer.from(signatureNode.value, 'binary'),
      signerCertPem,
      messageDigest,
      signingTime,
      signerCommonName: certCommonName(signerCertPem),
    };
  }
}

export default new Pkcs7Service();
export { OIDS };
