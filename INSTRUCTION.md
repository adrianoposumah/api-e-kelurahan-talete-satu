# Claude Code Agent Instruction — e-Kelurahan v2.0 BACKEND (Node.js + Express + Prisma)

## ROLE

You are implementing the **server-side** of e-Kelurahan v2.0. Migration from v1.1 (server-stored AES-encrypted RSA keys with custom PDF Info Dictionary format) to v2.0 (mobile-stored keys via Android Keystore, with **PAdES-B-B signature format** using PKCS#7 SignedData embedded in PDF /ByteRange).

**Your scope:** server only. The Android app is being migrated in a parallel effort by another agent in a separate repository. You and that agent communicate through the REST API contract specified below — implement to this contract exactly, and the mobile app will work.

This is a 2-3 week refactor. Do not attempt to complete in one pass. Work phase-by-phase, run acceptance tests after each phase, surface blockers immediately instead of guessing.

---

## CONTEXT YOU MUST READ FIRST

Before writing any code, read these files in this order:

1. **`mobile-key-implementation/MOBILE_KEY_IMPLEMENTATION_PLAN.md`** — overall migration plan. Read sections 1–5 fully. Sections about Android details can be skimmed (not your scope), but architecture and rationale are critical.
2. **`mobile-key-implementation/API_CONTRACTS.md`** — REST endpoints. Some fields differ in v2.0 PAdES (see "API CONTRACT" section below — the spec there overrides the reference file).
3. **`mobile-key-implementation/server/services/ca.service.js`** — reusable as-is.
4. **`mobile-key-implementation/server/services/enrollment.service.js`** — reusable as-is.
5. **`mobile-key-implementation/server/services/crypto.service.js`** — needs heavy rewrite for PAdES. Read to understand current shape, then refactor.
6. **`mobile-key-implementation/server/services/signing.service.js`** — needs heavy rewrite for PAdES. Read to understand current shape, then refactor.
7. **`mobile-key-implementation/server/controllers/*.js`** — mostly reusable with minor field-name adjustments.
8. **`mobile-key-implementation/server/prisma/schema-additions.prisma`** — merge into existing schema.
9. **Existing v1.1 server codebase in your workspace** — especially `services/crypto.service.js`, `services/pdf.service.js`, `services/verification.service.js`, `prisma/schema.prisma`, `routes/*.js`. Understand what exists before modifying.

Do not start coding until you have read all of the above. Confirm to the user when reading phase is complete, then proceed to Phase 0.

---

## ARCHITECTURE OVERVIEW (Server Perspective)

```
ENROLLMENT (server's role):
  Receive CSR (PKCS#10) from mobile
    → validate CSR signature & subject
    → sign with self-signed Root CA (RSA-4096, private key stored offline, encrypted)
    → return X.509 certificate
    → persist LurahCertificate record in DB

PER-LETTER SIGNING (server's role):
  prepare-signing endpoint:
    1. Validate submission status PENDING_LURAH
    2. Load active Lurah cert from DB
    3. Generate letter_number + verification_code
    4. Render PDF (existing pdf.service.renderLetter)
    5. Add PAdES /ByteRange placeholder using @signpdf/placeholder-plain
    6. Compute SHA-256 over /ByteRange bytes (the PDF content excluding signature placeholder)
    7. Build PKCS#7 signedAttributes as ASN.1 SET OF Attribute, containing:
       - contentType (OID 1.2.840.113549.1.9.3, value = data OID)
       - messageDigest (OID 1.2.840.113549.1.9.4, value = /ByteRange hash from step 6)
       - signingTime (OID 1.2.840.113549.1.9.5, value = UTC time)
       - signingCertificateV2 (OID 1.2.840.113549.1.9.16.2.47, ESSCertIDv2 referencing Lurah cert)
    8. DER-encode signedAttributes (tag 0x31 = SET OF)
    9. Persist SigningSession with bytesToSign (the DER bytes from step 8), pdfDraftPath, certificateId, TTL 5 min
    10. Return: { sessionId, expiresAt, pdfBase64, bytesToSignBase64, letterPreview }

  submit-signature endpoint:
    1. Load session, validate TTL not expired, status PENDING, ownership matches authenticated Lurah
    2. Load Lurah cert from session.certificateId
    3. Verify signature: RSA-PKCS1-v1_5 + SHA256, using cert.publicKey, over bytesToSign, against received signature
    4. Assemble complete PKCS#7 SignedData (ContentInfo wrapping SignedData):
       - version 1
       - digestAlgorithms = SET of SHA-256
       - encapContentInfo = data OID, no content (detached signature)
       - certificates = SET containing Lurah's X.509
       - signerInfos = SET containing one SignerInfo with:
         * version 1
         * issuerAndSerialNumber (from Lurah cert)
         * digestAlgorithm = SHA-256
         * signedAttrs = signedAttributes from step 7 above, BUT with tag IMPLICIT [0] (0xA0)
           instead of SET (0x31) — see "CRITICAL DER SUBTLETY" below
         * signatureAlgorithm = rsaEncryption OID
         * signature = signature bytes from mobile
    5. DER-encode the entire ContentInfo
    6. Hex-encode the DER bytes (each byte as 2 lowercase hex chars)
    7. Load draft PDF from disk
    8. Find /Contents placeholder (sequence of zero hex chars between < and >)
    9. Replace zeros with PKCS#7 hex, padding remaining space with `0` chars (PKCS#7 hex must FIT in placeholder; choose placeholder size of 8KB hex = 16384 chars)
    10. Save final PDF to letter storage
    11. Create IssuedLetter record (certificateId, signatureBase64, signedAt, filePath)
    12. Update submission status COMPLETED, session COMPLETED
    13. Return { issuedLetterId, letterNumber, verificationCode, signedAt, downloadUrl, verificationUrl }

VERIFICATION (server's role, public endpoint):
  Receive uploaded PDF → verify hybrid (server check + PAdES check):
    SERVER CHECK:
      - Extract verification_code from PDF (visible text or PDF metadata — implementation-dependent)
      - DB lookup: IssuedLetter by verification_code
      - Check: exists, status not REVOKED, not past expiry_date
    PADES CHECK:
      - Parse /ByteRange from PDF trailer (locate /Sig dict, read /ByteRange array)
      - Extract hex from /Contents placeholder, decode to DER PKCS#7 bytes
      - Parse PKCS#7 ContentInfo → SignedData → SignerInfo
      - Compute SHA-256 over PDF bytes per /ByteRange offsets
      - Compare with messageDigest attribute in signedAttributes
      - Verify signature: RSA-verify(signerCert.publicKey, SHA256(signedAttributesDer with SET tag), signature)
      - Verify cert chain: signerCert signed by Root CA
      - Cross-check: cert fingerprint matches IssuedLetter.certificate.fingerprint in DB
    HYBRID DECISION (truth table at Phase 4 below)
```

---

## API CONTRACT (What Mobile Will Call)

The mobile agent implements requests to these endpoints. You implement the server side to this exact contract. **Field names matter — mobile will parse JSON with these exact keys.**

### Authentication

All endpoints except verification require JWT Bearer token in `Authorization` header. JWT payload includes `user.id` and `user.role` (LURAH/ADMIN/etc.). Reuse existing v1.1 auth middleware.

### Endpoints

#### POST `/api/lurah/keys/enrollment-token`

**Auth:** LURAH JWT
**Request body:** Empty
**Response 200:**

```json
{
  "enrollmentToken": "string (random, TTL 10 min)",
  "expiresAt": "ISO 8601 string",
  "subjectTemplate": {
    "commonName": "string",
    "organization": "string",
    "organizationalUnit": "string",
    "country": "string (ISO 3166 alpha-2)"
  }
}
```

**Error responses:** 409 `ALREADY_ENROLLED` if Lurah has active cert.

#### POST `/api/lurah/keys/csr`

**Auth:** LURAH JWT
**Request body:**

```json
{
  "enrollmentToken": "string from previous endpoint",
  "csrPem": "-----BEGIN CERTIFICATE REQUEST-----\n...",
  "deviceLabel": "string (optional)"
}
```

**Response 200:**

```json
{
  "certificateId": "cuid",
  "certificatePem": "-----BEGIN CERTIFICATE-----\n...",
  "rootCaCertificatePem": "-----BEGIN CERTIFICATE-----\n...",
  "serialNumber": "hex string",
  "fingerprint": "SHA-256 hex of DER cert",
  "issuedAt": "ISO 8601",
  "expiresAt": "ISO 8601 (issuedAt + 3 years)"
}
```

**Error responses:** 400 `INVALID_CSR` if signature invalid, 400 `SUBJECT_MISMATCH` if subject differs from template, 410 `ENROLLMENT_TOKEN_EXPIRED` if token expired.

#### GET `/api/lurah/keys/certificate`

**Auth:** LURAH JWT
**Response 200:**

```json
{
  "certificateId": "cuid",
  "certificatePem": "...",
  "serialNumber": "...",
  "fingerprint": "...",
  "deviceLabel": "string or null",
  "issuedAt": "ISO 8601",
  "expiresAt": "ISO 8601",
  "status": "ACTIVE"
}
```

**Error responses:** 404 `NO_ACTIVE_CERTIFICATE` if not enrolled.

#### GET `/api/letters/pending`

**Auth:** LURAH JWT
**Query params:** `limit` (1-50, default 20), `cursor` (string, optional)
**Response 200:**

```json
{
  "items": [
    {
      "submissionId": "cuid",
      "letterType": "string enum",
      "warga": { "nik": "string", "nama": "string" },
      "keperluan": "string",
      "kepalaLingkunganApprovedAt": "ISO 8601",
      "kepalaLingkunganName": "string",
      "createdAt": "ISO 8601"
    }
  ],
  "nextCursor": "string or null"
}
```

#### GET `/api/letters/:submissionId`

**Auth:** LURAH JWT
**Response 200:**

```json
{
  "submissionId": "cuid",
  "letterType": "string",
  "warga": { "nik": "...", "nama": "...", "alamat": "...", "tanggalLahir": "...", "tempatLahir": "...", "pekerjaan": "...", "jenisKelamin": "...", "agama": "...", "kewarganegaraan": "..." },
  "lingkungan": "string",
  "keperluan": "string",
  "approvalHistory": [{ "role": "KEPALA_LINGKUNGAN", "name": "string", "approvedAt": "ISO 8601", "notes": "string or null" }],
  "status": "PENDING_LURAH",
  "createdAt": "ISO 8601"
}
```

#### POST `/api/letters/:submissionId/prepare-signing`

**Auth:** LURAH JWT
**Request body:** Empty
**Response 200:**

```json
{
  "sessionId": "cuid",
  "expiresAt": "ISO 8601 (preparedAt + 5 min)",
  "pdfBase64": "base64-encoded PDF bytes (with /ByteRange placeholder already inserted)",
  "bytesToSignBase64": "base64-encoded DER bytes of signedAttributes SET OF",
  "letterPreview": {
    "letterNumber": "string",
    "verificationCode": "string",
    "issuedDate": "YYYY-MM-DD",
    "expiryDate": "YYYY-MM-DD"
  }
}
```

**Note:** `bytesToSignBase64` is the DER-encoded PKCS#7 signedAttributes (with SET OF tag 0x31). Mobile will sign these bytes verbatim using SHA256withRSA. Do NOT pre-hash them — Android's SHA256withRSA does SHA-256 internally then RSA-signs the digest.

**Error responses:**

- 412 `ENROLLMENT_REQUIRED` if Lurah has no active cert
- 409 `INVALID_STATE` if submission not in PENDING_LURAH

#### POST `/api/letters/:submissionId/submit-signature`

**Auth:** LURAH JWT
**Request body:**

```json
{
  "sessionId": "cuid from prepare-signing",
  "signatureBase64": "base64-encoded RSA signature (256 bytes for RSA-2048)"
}
```

**Response 200:**

```json
{
  "issuedLetterId": "cuid",
  "letterNumber": "string",
  "verificationCode": "string",
  "signedAt": "ISO 8601",
  "downloadUrl": "/api/letters/{id}/download (relative URL)",
  "verificationUrl": "https://... (full URL to public verifier page)"
}
```

**Error responses:**

- 410 `SESSION_EXPIRED` if past TTL
- 409 `SESSION_ALREADY_COMPLETED` if session already finalized
- 400 `SIGNATURE_INVALID` if signature does not verify against bytesToSign with the registered cert

#### POST `/api/letters/:submissionId/reject`

**Auth:** LURAH JWT
**Request body:** `{ "reason": "string (required, non-empty)" }`
**Response 200:** `{ "submissionId": "...", "status": "REJECTED_BY_LURAH", "rejectedAt": "ISO 8601" }`

#### POST `/api/letters/verify` (PUBLIC)

**Auth:** None
**Content-Type:** multipart/form-data
**Body:** `file` (PDF)
**Response 200:**

```json
{
  "status": "VALID | TAMPERED | REVOKED | EXPIRED | FAKE | UNTRUSTED | UNREGISTERED_BUT_VALID_SIGNATURE",
  "verificationCode": "string or null",
  "issuedAt": "ISO 8601 or null",
  "expiresAt": "ISO 8601 or null",
  "checks": {
    "server": { "passed": boolean, "reason": "string or null" },
    "pades": { "passed": boolean, "reason": "string or null", "signerCommonName": "string or null" }
  },
  "publicData": {
    "letterNumber": "string",
    "letterType": "string",
    "signedAt": "ISO 8601"
  }
}
```

#### Error response format (all endpoints)

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable Indonesian/English string",
    "details": { "...": "..." }
  }
}
```

---

## CRITICAL TECHNICAL DETAILS

### Library recommendations

```bash
npm install node-forge @signpdf/placeholder-plain
```

- **PKCS#7 SignedData construction:** `node-forge` (v1.x). Its high-level `forge.pkcs7.createSignedData()` does NOT support external signatures (it wants to sign with a local private key). You must construct PKCS#7 manually using `forge.asn1` low-level builders. See "MANUAL PKCS#7 CONSTRUCTION" below.
- **PDF /ByteRange placement:** `@signpdf/placeholder-plain` (v3.x) for inserting the /Sig dict and /Contents placeholder.
- **X.509 cert operations:** `node-forge` (already used in `ca.service.js`).
- **PDF rendering:** Use existing v1.1 library (likely `pdfkit` or `pdf-lib`). Don't replace it.

### CRITICAL DER SUBTLETY (Read carefully — most common source of bugs)

PKCS#7 signedAttributes have **two different ASN.1 tag encodings** depending on context:

1. **When hashing for signature:** signedAttributes is encoded as `SET OF Attribute` with tag `0x31` (universal class, constructed, type SET). The hash that gets RSA-signed is `SHA-256(DER bytes of this SET OF tagged structure)`.

2. **When embedded in SignerInfo:** the SAME signedAttributes content is encoded with tag `0xA0` (context-specific class, constructed, IMPLICIT [0]). This is because SignerInfo's ASN.1 definition uses `[0] IMPLICIT SET OF Attribute`.

**Implementation pattern:**

- Build the SET OF Attribute structure with `forge.asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, attributes)`. Encode to DER. These DER bytes are what mobile signs. They are also what you send in `bytesToSignBase64`.
- When assembling the final PKCS#7 for embedding, create a separate ASN.1 node with the SAME children but with `asn1.Class.CONTEXT_SPECIFIC, 0` instead of `asn1.Class.UNIVERSAL, asn1.Type.SET`. This produces the IMPLICIT [0] tagged version.

If you mix these up, verification will fail even for a freshly signed document. Always test round-trip (sign → immediately verify) before declaring Phase 3 done.

### MANUAL PKCS#7 CONSTRUCTION (Pseudocode reference)

```javascript
const forge = require('node-forge');
const asn1 = forge.asn1;
const oids = forge.pki.oids;

// Helper: build single Attribute (SEQUENCE of OID + SET OF AttributeValue)
function buildAttribute(oid, value) {
  return asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(oid).getBytes()), asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, [value])]);
}

// Helper: build ESSCertIDv2 for signingCertificateV2 attribute
function buildSigningCertificateV2(signerCertObj) {
  // ESSCertIDv2 ::= SEQUENCE {
  //   hashAlgorithm AlgorithmIdentifier DEFAULT SHA-256,
  //   certHash OCTET STRING,
  //   issuerSerial IssuerSerial OPTIONAL
  // }
  // SigningCertificateV2 ::= SEQUENCE { certs SEQUENCE OF ESSCertIDv2 }
  const certDer = asn1.toDer(forge.pki.certificateToAsn1(signerCertObj)).getBytes();
  const certHash = forge.md.sha256.create().update(certDer).digest().getBytes();

  const essCertIdV2 = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, certHash)]);

  const signingCertV2 = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [essCertIdV2])]);

  return buildAttribute('1.2.840.113549.1.9.16.2.47', signingCertV2);
}

// PHASE 1 of signing flow: build signedAttributes SET OF — to send to mobile
function buildSignedAttributesDer(documentHash, signerCertObj, signingTime) {
  const attributes = [
    buildAttribute(oids.contentType, asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(oids.data).getBytes())),
    buildAttribute(oids.messageDigest, asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, documentHash)),
    buildAttribute(oids.signingTime, asn1.create(asn1.Class.UNIVERSAL, asn1.Type.UTCTIME, false, asn1.dateToUtcTime(signingTime))),
    buildSigningCertificateV2(signerCertObj),
  ];

  // Tag 0x31 = universal class, constructed, type SET
  const signedAttrsSet = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, attributes);
  return Buffer.from(asn1.toDer(signedAttrsSet).getBytes(), 'binary');
}

// PHASE 2 of signing flow: assemble final PKCS#7 — after mobile returns signature
function assemblePkcs7SignedData(signedAttrsDer, signatureBuffer, signerCertObj) {
  // Re-parse signedAttrs from DER, then switch tag
  const signedAttrsSet = asn1.fromDer(forge.util.createBuffer(signedAttrsDer));

  // Create IMPLICIT [0] tagged version with SAME children
  // Tag 0xA0 = context-specific class 0, constructed
  const signedAttrsImplicit = asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, signedAttrsSet.value);

  // Build SignerInfo
  const issuerAndSerial = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    forge.pki.distinguishedNameToAsn1({ attributes: signerCertObj.issuer.attributes }),
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, forge.util.hexToBytes(signerCertObj.serialNumber)),
  ]);

  const sha256AlgoId = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(oids.sha256).getBytes()),
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, ''),
  ]);

  const rsaAlgoId = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(oids.rsaEncryption).getBytes()),
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, ''),
  ]);

  const signerInfo = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, asn1.integerToDer(1).getBytes()),
    issuerAndSerial,
    sha256AlgoId,
    signedAttrsImplicit, // IMPLICIT [0] tagged
    rsaAlgoId,
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, signatureBuffer.toString('binary')),
  ]);

  // Build SignedData
  const signedData = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, asn1.integerToDer(1).getBytes()),
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, [sha256AlgoId]),
    // encapContentInfo (data OID, no content for detached)
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(oids.data).getBytes())]),
    // certificates (IMPLICIT [0], optional but recommended)
    asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [forge.pki.certificateToAsn1(signerCertObj)]),
    // signerInfos
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, [signerInfo]),
  ]);

  // Wrap in ContentInfo
  const contentInfo = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(oids.signedData).getBytes()),
    asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [signedData]),
  ]);

  return Buffer.from(asn1.toDer(contentInfo).getBytes(), 'binary');
}
```

Validate output: `openssl pkcs7 -inform DER -in test.p7s -print` should parse without error and show the SignedData structure.

### /ByteRange mechanics

PAdES /ByteRange format in PDF:

```
/Type /Sig
/Filter /Adobe.PPKLite
/SubFilter /adbe.pkcs7.detached
/ByteRange [0 N1 N2 N3]
/Contents <hex_zeros_padded_to_~8KB>
```

- `0` = start of file
- `N1` = bytes from start up to and including `<` of /Contents
- `N2` = position right after `>` closing /Contents
- `N3` = remaining bytes to end of file

The hash is computed over `pdfBytes[0..N1]` concatenated with `pdfBytes[N2..N2+N3]` (i.e., everything except the placeholder).

`@signpdf/placeholder-plain` handles placement. After placement:

1. Re-parse the modified PDF to extract /ByteRange offsets
2. Read bytes per /ByteRange
3. SHA-256 those bytes → use as messageDigest in PKCS#7
4. At submission time, build PKCS#7 (with messageDigest from step 3 and signature from mobile)
5. Hex-encode PKCS#7 DER (lowercase hex, no separators)
6. Pad with `0` chars to fill placeholder exactly
7. Write hex into /Contents placeholder position (between < and >)

Choose placeholder size of 16384 hex chars (8KB binary). One X.509 + signedAttrs + RSA-2048 signature ≈ 2-3KB binary. 8KB gives safe margin.

**Pitfall:** if your PDF library re-encodes the PDF after `@signpdf/placeholder-plain` places the placeholder, /ByteRange offsets become wrong. Always finalize PDF rendering BEFORE adding placeholder, and never modify after.

---

## EXECUTION PLAN

### PHASE 0: Workspace Preparation

1. Verify access to v1.1 codebase and `mobile-key-implementation/` reference folder.
2. Read all files listed in "CONTEXT YOU MUST READ FIRST".
3. Install new dependencies:
   ```bash
   npm install node-forge @signpdf/placeholder-plain
   ```
4. Tag current v1.1 in git: `git tag v1.1-stable`. Create migration branch `git checkout -b v2.0-pades-migration`.
5. Inspect existing `services/pdf.service.js`. Identify the PDF library used (pdfkit / pdf-lib / other). Report to user with assessment of compatibility with @signpdf/placeholder-plain. **STOP and wait for user confirmation before proceeding** if PDF library is not pdfkit or pdf-lib.

**Acceptance:**

- [ ] All reference files read
- [ ] Dependencies installed without conflict
- [ ] Existing PDF library identified, compatibility confirmed with user
- [ ] User notified, awaiting go-ahead for Phase 1

### PHASE 1: Root CA Bootstrap

1. Copy `mobile-key-implementation/server/services/ca.service.js` to `services/ca.service.js`. No modifications needed.
2. Add env vars to `.env.example`:
   ```
   ROOT_CA_CERT_PATH=/secure-storage/root-ca-cert.pem
   ROOT_CA_KEY_PATH=/secure-storage/root-ca-key.pem
   ROOT_CA_KEY_PASSPHRASE=<set in actual .env, never commit>
   ```
3. Write one-off bootstrap script `scripts/bootstrap-root-ca.js`:
   ```javascript
   require('dotenv').config();
   const ca = require('../services/ca.service');
   ca.bootstrapRootCa()
     .then(() => console.log('Root CA bootstrapped successfully'))
     .catch((err) => {
       console.error(err);
       process.exit(1);
     });
   ```
4. Set ROOT_CA_KEY_PASSPHRASE in actual `.env` (random 32+ chars). Add `.env` to `.gitignore` if not already.
5. Create directory: `mkdir -p /secure-storage && chmod 700 /secure-storage`.
6. Run: `node scripts/bootstrap-root-ca.js`.
7. Verify: `openssl x509 -in /secure-storage/root-ca-cert.pem -text -noout`. Confirm CA: TRUE, validity 10 years, keyUsage keyCertSign + cRLSign.
8. Document for user: backup the private key file (`/secure-storage/root-ca-key.pem`) to offline storage. Never commit, never email, never put in cloud-synced folders.

**Acceptance:**

- [ ] `services/ca.service.js` in place
- [ ] Env vars documented
- [ ] Root CA files exist with permissions 0644 (cert) and 0600 (key)
- [ ] OpenSSL parses cert successfully with expected attributes
- [ ] User reminded to backup private key offline

### PHASE 2: Database Schema + Enrollment Service

1. Open existing `prisma/schema.prisma` and `mobile-key-implementation/server/prisma/schema-additions.prisma` side by side.
2. Merge the additions into your schema:
   - Add `LurahCertificate` model
   - Add `CertificateStatus` enum
   - Add `SigningSession` model
   - Add `SigningSessionStatus` enum
   - Update `IssuedLetter`: add `certificateId String?`, `signatureBase64 String? @db.Text`, `signedAt DateTime`, add relation to `LurahCertificate`
   - Update `User`: add back-relations `lurahCertificates LurahCertificate[]`, `signingSessions SigningSession[]`
   - Update `Submission`: add back-relation `signingSessions SigningSession[]`
3. Run `npx prisma migrate dev --name add_mobile_key_models_v2`. If errors, do NOT use `--force` — read the error, understand the conflict, fix manually.
4. Run `npx prisma generate`.
5. Copy `mobile-key-implementation/server/services/enrollment.service.js` to `services/`. No modifications.
6. Copy `mobile-key-implementation/server/controllers/enrollment.controller.js` to `controllers/`. No modifications.
7. Add routes (location depends on existing route structure):
   ```javascript
   const enrollmentController = require('../controllers/enrollment.controller');
   router.post('/api/lurah/keys/enrollment-token', authMiddleware('LURAH'), enrollmentController.requestToken);
   router.post('/api/lurah/keys/csr', authMiddleware('LURAH'), enrollmentController.submitCsr);
   router.get('/api/lurah/keys/certificate', authMiddleware('LURAH'), enrollmentController.getActiveCert);
   router.post('/api/lurah/keys/:certificateId/revoke', authMiddleware('ADMIN'), enrollmentController.revokeCert);
   ```
   Adjust `authMiddleware` signature to match existing convention.
8. Write integration test in `tests/enrollment.test.js`:
   - Generate test RSA-2048 keypair with `forge.pki.rsa.generateKeyPair`
   - Build CSR with subject matching SUBJECT_TEMPLATE
   - POST to /enrollment-token (with mock JWT), then /csr
   - Assert response has valid X.509 cert PEM
   - Verify cert chain: `forge.pki.verifyCertificateChain(caStore, [issuedCert])` returns true

**Acceptance:**

- [ ] Schema migrated, `lurah_certificates` and `signing_sessions` tables exist
- [ ] Integration test for enrollment passes
- [ ] DB has LurahCertificate row after test
- [ ] `openssl verify -CAfile root-ca-cert.pem issued-cert.pem` returns OK

### PHASE 3: PAdES Signing Pipeline

This is the most complex phase. **Allocate 5-7 days minimum.** Split into sub-phases and commit each separately.

#### 3.1 PKCS#7 service (NEW FILE)

Create `services/pkcs7.service.js`. Implement:

- `buildSignedAttributesDer(documentHash, signerCertObj, signingTime)` → Buffer of DER-encoded SET OF Attribute (tag 0x31). This is the "bytesToSign" sent to mobile.
- `assemblePkcs7SignedData(signedAttrsDer, signatureBuffer, signerCertPem)` → Buffer of DER-encoded PKCS#7 ContentInfo. This goes into /Contents placeholder.
- `parsePkcs7FromHex(hexString)` → `{ signedAttributesDer, signatureBytes, signerCertPem, messageDigest, signingTime }`. Used by verifier.

Write unit test `tests/pkcs7.service.test.js`:

1. Generate test keypair + self-signed cert
2. Build signedAttrs with known document hash
3. Sign signedAttrs with `crypto.createSign('RSA-SHA256').update(signedAttrsDer).sign(privateKeyPem)`
4. Assemble PKCS#7
5. **Validate with OpenSSL:** write PKCS#7 to file, run `openssl pkcs7 -inform DER -in /tmp/test.p7s -print`. Must parse without error.
6. Verify signature manually: parse, extract signedAttrs DER + signature + cert, verify with `crypto.createVerify`.
7. Round-trip test: assemble → parse → re-verify with same data.

**Do not move to 3.2 until 3.1 round-trip test passes.**

#### 3.2 PDF service additions

Modify `services/pdf.service.js`. Keep existing `renderLetter()` (or whatever the v1.1 function is called). Add:

- `addByteRangePlaceholder(pdfBuffer)` → uses `@signpdf/placeholder-plain` to insert /Sig field with /ByteRange [0 0 0 0] and /Contents <0000...> (placeholder size 16384 hex chars). Returns modified PDF Buffer.
- `extractByteRange(pdfBuffer)` → parses PDF trailer, finds /Sig dict, returns `{ byteRange: [N0, N1, N2, N3], contentsHexOffset, contentsHexLength }`.
- `computeByteRangeHash(pdfBuffer, byteRange)` → SHA-256 of `pdfBuffer.slice(byteRange[0], byteRange[0]+byteRange[1])` concatenated with `pdfBuffer.slice(byteRange[2], byteRange[2]+byteRange[3])`. Returns 32-byte Buffer.
- `embedPkcs7Hex(pdfBuffer, pkcs7Hex, contentsHexOffset, contentsHexLength)` → writes pkcs7Hex into the placeholder, padding with `0` chars to fill exactly contentsHexLength. Returns modified PDF Buffer.

**KEEP** existing v1.1 functions (`embedSignatureMetadata` etc.) — do not delete. v1.1 letters issued before this migration may still need them for historical verification. Mark them deprecated in comments.

Unit tests:

- Placeholder insertion: render simple PDF, add placeholder, verify resulting PDF has /Sig dict with /ByteRange [0 0 0 0] and /Contents containing zeros.
- Hash computation: place placeholder, compute hash, modify a byte outside /Contents, compute hash again → must differ. Modify a byte inside /Contents → must NOT differ (because /Contents is excluded from hash).
- Embed: place placeholder, embed test hex, verify /Contents now contains the hex (no longer zeros).

#### 3.3 Crypto service refactor

Modify existing `services/crypto.service.js`:

- **REMOVE** (or move to `services/legacy-crypto.service.js` for historical use):
  - `signCanonical()`, `verifyCanonical()` if exist
  - `buildCanonicalData()`, `serializeCanonical()`, `computeContentHash()` (v1.1 body_hash)
  - `decryptPrivateKey()`, `encryptPrivateKey()` (server-side key storage)
  - Any passphrase-based signing functions
- **ADD/KEEP:**
  - `verifySignature(dataToSign, signatureBase64, certificatePem)` — verifies RSA-PKCS1-v1_5 + SHA256 using Node's `crypto.createVerify('RSA-SHA256')`. Returns boolean.
  - `verifyCertChain(leafCertPem, rootCaCertPem)` — uses `forge.pki.verifyCertificateChain` with caStore containing root.
  - `computeCertFingerprint(certPem)` — SHA-256 hex of DER cert (helper for matching cert to DB).

Document the breaking change: any callers of removed functions will fail. Search the codebase for usages and either delete the calling code (if v2.0-only) or route through `legacy-crypto.service.js` (if historical letter verification still needed).

#### 3.4 Signing service rewrite

Rewrite `services/signing.service.js`. Use `mobile-key-implementation/server/services/signing.service.js` as starting template but make these changes:

In `prepareSigningSession()`:

- Replace step "build canonical data + body_hash" with:
  1. Call `pdf.service.renderLetter()` to get base PDF (already does this)
  2. Call `pdf.service.addByteRangePlaceholder(pdfBytes)` → get PDF with placeholder
  3. Call `pdf.service.extractByteRange(pdfWithPlaceholder)` → get byteRange offsets
  4. Call `pdf.service.computeByteRangeHash(pdfWithPlaceholder, byteRange)` → 32-byte hash
  5. Parse Lurah cert: `const certObj = forge.pki.certificateFromPem(activeCert.certificatePem)`
  6. Call `pkcs7.service.buildSignedAttributesDer(byteRangeHash, certObj, new Date())` → bytesToSign
- Save PDF (with placeholder, ready for hex injection) to `pdfDraftPath`
- Persist SigningSession with `dataToSign` field renamed to `bytesToSign` (store as base64 or hex string in DB)
- Return: `{ sessionId, expiresAt, pdfBase64, bytesToSignBase64, letterPreview }` — note: `dataToSign` field GONE, `bodyHash` field GONE

In `validateAndFinalize()`:

- After signature verification step, replace "embed in Info Dictionary" with:
  1. Parse Lurah cert: `const certObj = forge.pki.certificateFromPem(session.certificate.certificatePem)`
  2. Decode bytesToSign from session (base64 → Buffer)
  3. Decode signature from request (base64 → Buffer)
  4. Call `pkcs7.service.assemblePkcs7SignedData(bytesToSignBuffer, signatureBuffer, certObj)` → PKCS#7 Buffer
  5. Hex-encode: `const pkcs7Hex = pkcs7Buffer.toString('hex')`
  6. Load draft PDF, extract byteRange again to get `contentsHexOffset` and `contentsHexLength`
  7. Call `pdf.service.embedPkcs7Hex(draftPdfBytes, pkcs7Hex, contentsHexOffset, contentsHexLength)` → final PDF
  8. Save final PDF to letter storage

Other functions (`listPendingLetters`, `getSubmissionDetail`, `rejectSubmission`, `cleanupExpiredSessions`) unchanged from reference.

#### 3.5 Controller adjustments

Copy `mobile-key-implementation/server/controllers/signing.controller.js` to `controllers/`. Adjust `prepareSigning` response:

- Replace `dataToSign` with `bytesToSignBase64`
- Remove `bodyHash` field entirely from response

Add routes to existing route registration:

```javascript
const signingController = require('../controllers/signing.controller');
router.get('/api/letters/pending', authMiddleware('LURAH'), signingController.listPending);
router.get('/api/letters/:submissionId', authMiddleware('LURAH'), signingController.getDetail);
router.post('/api/letters/:submissionId/prepare-signing', authMiddleware('LURAH'), signingController.prepareSigning);
router.post('/api/letters/:submissionId/submit-signature', authMiddleware('LURAH'), signingController.submitSignature);
router.post('/api/letters/:submissionId/reject', authMiddleware('LURAH'), signingController.reject);
```

#### 3.6 End-to-end sign test (without mobile)

Write `tests/signing-e2e.test.js`:

1. Seed DB with test Lurah + active certificate
2. Generate test private key locally (representing what would be in mobile Keystore)
3. Create test submission with PENDING_LURAH status
4. Call prepareSigningSession → get bytesToSign
5. Sign locally: `crypto.createSign('RSA-SHA256').update(bytesToSign).sign(testPrivateKeyPem)`
6. Call validateAndFinalize with signature → get IssuedLetter
7. Read final PDF from filesystem
8. Validate with openssl:
   ```bash
   # Extract signature: not trivial since /ByteRange embedded
   # Use: openssl smime -verify ... OR manual parsing
   ```
9. Manually parse PKCS#7 from PDF, verify signature, verify cert chain to Root CA

**This test must pass before moving to Phase 4.**

**Acceptance for Phase 3:**

- [ ] pkcs7.service unit tests pass, including OpenSSL parse validation
- [ ] PDF placeholder/hash/embed unit tests pass
- [ ] Signing E2E test produces PDF with valid PAdES signature
- [ ] Final PDF opens in Adobe Reader (will show "validity unknown" or "untrusted root" — that's expected, but Reader must detect a signature exists)

### PHASE 4: Verification Service

Rewrite `services/verification.service.js`. Drop body_hash logic entirely. Implement hybrid:

```javascript
async function verifyPdf(pdfBuffer) {
  // 1. Extract verification_code from PDF
  //    Implementation depends on how renderer embeds it.
  //    Options: (a) visible text via OCR (heavy), (b) PDF metadata field, (c) /Info dict key.
  //    Recommended: keep v1.1 approach of embedding in /Info dict for retrieval.
  const verificationCode = extractVerificationCode(pdfBuffer);

  // 2. Server check
  const dbRecord = verificationCode
    ? await prisma.issuedLetter.findUnique({
        where: { verificationCode },
        include: { certificate: true },
      })
    : null;

  const serverCheck = computeServerCheck(dbRecord);

  // 3. PAdES check
  const padesCheck = await computePadesCheck(pdfBuffer, dbRecord);

  // 4. Hybrid decision
  const status = decideStatus(serverCheck, padesCheck);

  return { status, verificationCode, checks: { server: serverCheck, pades: padesCheck }, publicData: dbRecord ? extractPublicFields(dbRecord) : null };
}

async function computePadesCheck(pdfBuffer, dbRecord) {
  try {
    // Extract /ByteRange
    const { byteRange, contentsHex } = pdfService.extractByteRange(pdfBuffer);

    // Strip trailing zeros from contentsHex (placeholder padding)
    const trimmedHex = contentsHex.replace(/0+$/, '');
    if (trimmedHex.length % 2 !== 0) {
      // padding was odd, restore one zero
      trimmedHex += '0';
    }

    // Parse PKCS#7
    const pkcs7 = pkcs7Service.parsePkcs7FromHex(trimmedHex);

    // Compute hash over /ByteRange bytes
    const computedHash = pdfService.computeByteRangeHash(pdfBuffer, byteRange);

    // Compare messageDigest
    if (!computedHash.equals(pkcs7.messageDigest)) {
      return { passed: false, reason: 'CONTENT_MODIFIED' };
    }

    // Verify signature
    const sigValid = cryptoService.verifySignature(pkcs7.signedAttributesDer, pkcs7.signatureBytes, pkcs7.signerCertPem);
    if (!sigValid) {
      return { passed: false, reason: 'SIGNATURE_INVALID' };
    }

    // Verify cert chain
    const rootCa = caService.loadRootCa();
    const chainValid = cryptoService.verifyCertChain(pkcs7.signerCertPem, rootCa.certificatePem);
    if (!chainValid) {
      return { passed: false, reason: 'UNTRUSTED_SIGNER' };
    }

    // Cross-check fingerprint with DB
    if (dbRecord && dbRecord.certificate) {
      const signerFingerprint = cryptoService.computeCertFingerprint(pkcs7.signerCertPem);
      if (signerFingerprint !== dbRecord.certificate.fingerprint) {
        return { passed: false, reason: 'SIGNER_MISMATCH' };
      }
    }

    return {
      passed: true,
      reason: null,
      signerCommonName: extractCommonName(pkcs7.signerCertPem),
    };
  } catch (err) {
    console.error('PAdES check error:', err);
    return { passed: false, reason: 'PARSE_ERROR' };
  }
}
```

Status truth table:

| serverCheck           | padesCheck               | status                                                  |
| --------------------- | ------------------------ | ------------------------------------------------------- |
| pass                  | pass                     | `VALID`                                                 |
| pass                  | fail (CONTENT_MODIFIED)  | `TAMPERED`                                              |
| pass                  | fail (SIGNATURE_INVALID) | `TAMPERED`                                              |
| pass                  | fail (UNTRUSTED_SIGNER)  | `UNTRUSTED`                                             |
| pass                  | fail (SIGNER_MISMATCH)   | `TAMPERED`                                              |
| pass                  | fail (PARSE_ERROR)       | `INVALID_FORMAT`                                        |
| fail (NOT_REGISTERED) | pass                     | `UNREGISTERED_BUT_VALID_SIGNATURE` (suspicious, log it) |
| fail (NOT_REGISTERED) | fail                     | `FAKE`                                                  |
| fail (REVOKED)        | pass                     | `REVOKED`                                               |
| fail (EXPIRED)        | pass                     | `EXPIRED`                                               |
| fail (any)            | fail (any)               | `FAKE`                                                  |

Tests:

- VALID: properly issued PDF
- TAMPERED: modify one byte in body
- TAMPERED (SIGNER_MISMATCH): take valid PDF, swap signer cert with a different valid one in DB
- REVOKED: mark IssuedLetter REVOKED in DB
- FAKE: random unrelated PDF
- UNTRUSTED: cert not signed by our Root CA (e.g., generate ad-hoc cert with different CA)

**Acceptance:**

- [ ] All status codes return correctly per truth table
- [ ] Test coverage for at least 6 of 10 status outcomes

### PHASE 5: Cleanup Job + Cron

Set up cleanup of expired signing sessions:

```javascript
// services/signing.service.js — already has cleanupExpiredSessions()
// Schedule via node-cron or similar:
const cron = require('node-cron');
const signingService = require('./services/signing.service');
cron.schedule('*/5 * * * *', async () => {
  try {
    await signingService.cleanupExpiredSessions();
  } catch (err) {
    console.error('Cleanup job failed:', err);
  }
});
```

**Acceptance:**

- [ ] Cleanup job runs every 5 minutes
- [ ] Expired sessions marked EXPIRED
- [ ] Draft PDF files deleted

---

## CONSTRAINTS

### DO NOT modify or remove:

- Existing authentication flow (JWT, login, role middleware)
- Existing submission creation flow (warga submit, KL approval)
- Frontend (warga-facing app) — separate scope
- v1.1 IssuedLetter records — historical data stays
- v1.1 crypto.service functions that serve historical verification — preserve in `legacy-crypto.service.js` if needed

### DO NOT:

- Skip phases — dependencies: Phase 3 needs Phase 1+2
- Combine phases into single commits — keep changes reviewable
- Add new dependencies beyond `node-forge`, `@signpdf/placeholder-plain` without user confirmation
- Hardcode keys, passphrases, or paths — use env vars
- Use MD5 or SHA-1 anywhere
- Touch existing v1.1 endpoints — they're frozen for backward compat

### DO:

- Commit after each acceptance criteria passes
- Run lint/format after each file change
- Write tests BEFORE integration (TDD especially for pkcs7.service)
- Surface ambiguity — don't guess
- Reference RFC 5652 (CMS) and ETSI EN 319 142-1 (PAdES) when implementing ASN.1

---

## TECHNICAL ESCALATION TRIGGERS

Stop and ask user when:

1. **PKCS#7 ASN.1 does not parse with OpenSSL** (`openssl pkcs7 -inform DER -in test.p7s -print` errors). Indicates structural bug. Compare byte-by-byte with a reference PKCS#7 produced by `openssl smime -sign -outform DER`.
2. **Adobe Reader fails to detect any signature** in final PDF. May indicate /ByteRange offsets wrong or /Contents placeholder malformed.
3. **Signature verification fails for fresh-signed PDF** (round-trip should always succeed).
4. **node-forge ASN.1 APIs missing** for some required structure. May need `asn1.js` as alternative.
5. **Existing PDF library re-encodes after placeholder insertion**, breaking /ByteRange offsets.

For each: pause, document the blocker, propose 2-3 options with trade-offs, wait for user direction.

---

## DELIVERABLES CHECKLIST

When all phases complete:

- [ ] Self-signed Root CA bootstrapped, private key offline-backed
- [ ] All enrollment endpoints functional and tested
- [ ] All signing endpoints functional, prepare → submit flow produces valid PAdES PDF
- [ ] Verifier returns correct status per truth table
- [ ] Cleanup cron job running
- [ ] All v1.1 code preserved for historical letter verification
- [ ] API contract matches specification exactly (mobile agent can integrate)

Begin with Phase 0. Confirm context-reading complete and PDF library compatibility before proceeding to Phase 1.
