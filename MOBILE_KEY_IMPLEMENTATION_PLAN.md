# Mobile Key Implementation Plan — e-Kelurahan v2.0

**Target:** Migrasi dari arsitektur server-stored key (v1.1) ke arsitektur mobile-stored key dengan Android Keystore, mempertahankan format canonical + body_hash + embed signature di PDF Info Dictionary (TIDAK pindah ke PAdES dalam scope ini).

**Estimasi waktu:** 2-3 minggu kerja fokus untuk satu developer (backend + mobile).

**Versi canonical target:** `"2.0"` (membedakan dengan v1.1 yang server-signed).

**Kebijakan rollback:** **Clean break.** Endpoint signing server-side (`POST /v1/submissions/:id/lurah/approve` dengan passphrase, `POST /v1/keys/generate` dengan passphrase) **dihapus total**. Rollback dilakukan via `git revert` jika perlu.

---

## 1. Ringkasan Eksekutif

### Apa yang Berubah dari v1.1

| Aspek | v1.1 (sekarang) | v2.0 (target) |
|---|---|---|
| Lokasi private key Lurah | Server (`LurahKey.encryptedPrivateKey`, AES-256-GCM) | Android Keystore (hardware-backed) |
| Siapa yang execute signing | Server (Node `crypto.createSign`) | Android Keystore (mobile) |
| Akses ke key | Passphrase typed Lurah | Biometric per-operation |
| Non-repudiation | Lemah — server bisa sign sendiri | Kuat — perlu fisik device + biometric |
| Format embed signature di PDF | Info Dictionary custom (XMP-like) | **TIDAK berubah** |
| Format canonical | JSON deterministik dengan `body_hash` | **TIDAK berubah strukturnya**, hanya `version: "1.1"` → `"2.0"` dan tambah `signer_certificate_fingerprint` |
| Sertifikat Lurah | Tidak ada (hanya raw public key di `LurahKey.publicKey`) | X.509 ditandatangani Root CA, tersimpan di `LurahKey.certificatePem` |
| Root CA | Tidak ada | Self-signed, key offline, tersimpan di `secure-storage/` |
| Endpoint signing | `POST /v1/submissions/:id/lurah/approve` (passphrase) | `prepare-signing` + `submit-signature` (2 fase) |

### Trust Model

```
Server e-Kelurahan
├── Root CA (self-signed RSA-4096, key offline backup)
│   └── Menerbitkan X.509 untuk Lurah saat enrollment
└── PostgreSQL
    ├── lurah_keys (publicKey + certificatePem + serialNumber + fingerprint, status)
    ├── signing_sessions (TTL 5 menit)
    └── issued_letters (dengan signature dari mobile, signatureKeyId → lurah_keys.id)

Mobile (perangkat Lurah)
└── Android Keystore (hardware-backed jika tersedia)
    └── Lurah private key
        ├── RSA-2048 (rekomendasi) atau RSA-4096
        ├── setUserAuthenticationRequired(true)
        ├── setUserAuthenticationParameters(0, BIOMETRIC_STRONG)
        └── setInvalidatedByBiometricEnrollment(true)
```

---

## 2. Scope Perubahan (Backend)

### 2.1 File Eksisting yang DIUBAH

| File | Perubahan |
|---|---|
| [src/services/crypto.service.js](src/services/crypto.service.js) | Pertahankan `buildCanonicalData`, `extractBodyHashFromCanonical`, `verifyLetterSignature`, `hashCanonicalData`, `generatePublicKeyFingerprint`. **Hapus** `createLetterSignature`, `decryptPrivateKey`, `encryptPrivateKey`, `changePassphrase`, `generateLurahKey`, `getLurahKey` (mode signing). **Tambah** `buildCanonicalDataV2`, `verifySignatureFromCertificate`, `verifyCertChain`. |
| [src/services/letter.service.js](src/services/letter.service.js) | Refactor `issueLetter` jadi 2 fungsi exported: `prepareLetterDraft(submissionId, lurahUserId, { note, keterangan })` (PHASE 1-4) dan `finalizeIssuedLetter(session, signature)` (PHASE 5-7). Hapus parameter `passphrase`. |
| [src/services/pdf.service.js](src/services/pdf.service.js) | `finalizeSignedPdf` sekarang menerima `signatureData` dari parameter (tidak generate). Tidak ada perubahan struktur file (sudah modular). |
| [src/services/verification.service.js](src/services/verification.service.js) | Tambah `runTrustCheck(metadata, issuedLetter)` (verify cert chain → Root CA). Update `decideVerificationResult` truth table dengan status `UNTRUSTED_SIGNER`. |
| [src/controllers/key.controller.js](src/controllers/key.controller.js) | **Hapus** `generateKey` handler (passphrase flow). **Tambah** `requestEnrollmentToken`, `submitCsr`, `getCertificate`, `rotateKey`. Pertahankan `getKeyStatus`, `getCurrentPublicKey`, `getPublicKeyByLetter`, `listKeys`, `revokeKey` (response cert diperluas). |
| [src/controllers/submission.controller.js](src/controllers/submission.controller.js) | **Hapus** `approveByLurah` (passphrase flow), atau ubah handlernya jadi return HTTP 410 Gone. **Tambah** `prepareSigning`, `submitSignature`. |
| [src/routes/key.routes.js](src/routes/key.routes.js) | Hapus route `POST /generate`. Tambah `POST /enrollment-token`, `POST /csr`, `GET /certificate`, `POST /rotate`. |
| [src/routes/submission.routes.js](src/routes/submission.routes.js) | Hapus route `POST /:id/lurah/approve` (atau ubah handler ke 410). Tambah `POST /:id/lurah/prepare-signing`, `POST /:id/lurah/submit-signature`. |
| [src/app.js](src/app.js) | Tidak ada perubahan struktur (route mount tetap sama). |
| [prisma/schema.prisma](prisma/schema.prisma) | Lihat Step 2 di Section 3. |

### 2.2 File BARU

| File | Fungsi |
|---|---|
| `scripts/bootstrap-root-ca.js` | One-shot script untuk generate Root CA keypair + self-signed cert. Output ke `secure-storage/`. |
| `src/services/ca.service.js` | Load Root CA key/cert, sign CSR jadi sertifikat Lurah. |
| `src/services/enrollment.service.js` | Orchestrate enrollment: validate token, validate CSR, sign via ca.service, simpan ke `LurahKey`. |
| `src/services/signing.service.js` | Manage `SigningSession` (create, validate, expire, finalize). |

### 2.3 File yang DIDEPRESIASI (Dihapus)

| File / Field | Aksi |
|---|---|
| `LurahKey.encryptedPrivateKey` | Schema diubah jadi nullable. Kolom dipertahankan untuk surat historis yang sudah terbit dengan v1.1 (untuk dekripsi audit, dll). Tidak ada endpoint baru yang menulis ke kolom ini. |
| `cryptoService.encryptPrivateKey` / `decryptPrivateKey` / `changePassphrase` | **Hapus.** |
| `cryptoService.generateLurahKey` (server-side keypair) | **Hapus.** |
| `cryptoService.createLetterSignature` | **Hapus.** Digantikan oleh flow di `signing.service.js`. |
| `letterService.issueLetter({ passphrase })` | **Hapus.** Pecah jadi `prepareLetterDraft` + `finalizeIssuedLetter`. |
| Handler `POST /v1/keys/generate` | **Hapus** route. |
| Handler `POST /v1/submissions/:id/lurah/approve` | **Hapus** route. |

### 2.4 File BARU di Android (Kotlin) — Untuk Referensi

Lihat folder `android/` untuk reference implementation. Daftar singkat:

| File | Fungsi |
|---|---|
| `crypto/KeyManager.kt` | Wrapper Android Keystore (generate, exists, getPublicKey) |
| `crypto/CsrGenerator.kt` | Generate PKCS#10 CSR dengan BouncyCastle |
| `crypto/SigningCoordinator.kt` | Signing dengan biometric prompt |
| `crypto/ByteRangeHasher.kt` | Compute body_hash untuk verifikasi PDF dari server |
| `crypto/CertificateStorage.kt` | Simpan cert Lurah + Root CA di EncryptedSharedPreferences |
| `data/LurahApiService.kt` | Retrofit interface (base path `/v1`) |
| `data/Models.kt` | Data classes match response envelope `{ success, data }` |
| `data/EnrollmentRepository.kt` | Orchestrate enrollment flow |
| `data/SigningRepository.kt` | Orchestrate signing flow |
| `ui/EnrollmentViewModel.kt` | UI state enrollment |
| `ui/SigningViewModel.kt` | UI state signing |

---

## 3. Eksekusi Step-by-Step

### Step 1: Bootstrap Root CA

**Hanya sekali, di setup environment.**

1. Buat `scripts/bootstrap-root-ca.js`.
2. Generate RSA-4096 keypair untuk Root CA (`crypto.generateKeyPairSync` + `node-forge` untuk wrapper X.509).
3. Self-sign dengan validity 10 tahun, CN=`Kelurahan Talete Satu Root CA`.
4. Output ke `secure-storage/root-ca-cert.pem` dan `secure-storage/root-ca-key.pem`.
5. **Tambah `secure-storage/` ke `.gitignore`.**
6. **Backup `root-ca-key.pem` ke USB offline.**
7. Tambah env vars di `.env.production`:
   - `ROOT_CA_CERT_PATH=secure-storage/root-ca-cert.pem`
   - `ROOT_CA_KEY_PATH=secure-storage/root-ca-key.pem`
   - `ROOT_CA_KEY_PASSPHRASE=<strong-passphrase>` (key disimpan encrypted)
8. Update [src/config/env.js](src/config/env.js) untuk expose 3 env baru.

**Acceptance:**
- [ ] `node scripts/bootstrap-root-ca.js` sukses, file cert+key terbentuk
- [ ] `openssl x509 -in secure-storage/root-ca-cert.pem -text -noout` menunjukkan validity 10 tahun, basic constraint `CA:TRUE`
- [ ] `secure-storage/` tidak masuk ke git status

### Step 2: Update Prisma Schema

Edit [prisma/schema.prisma](prisma/schema.prisma):

**A. Modifikasi `LurahKey`:**

```prisma
model LurahKey {
  id                  BigInt        @id @default(autoincrement()) @db.BigInt
  lurahProfileId      BigInt        @map("lurah_profile_id") @db.BigInt
  publicKey           String        @map("public_key") @db.Text
  encryptedPrivateKey String?       @map("encrypted_private_key") @db.Text  // nullable di v2.0
  algorithm           String        @default("RSA-SHA256") @db.VarChar(50)
  status              KeyStatus     @default(ACTIVE)

  // v2.0 NEW
  certificatePem      String?       @map("certificate_pem") @db.Text
  serialNumber        String?       @unique @map("serial_number") @db.VarChar(64)
  fingerprint         String?       @unique @map("fingerprint") @db.VarChar(128)
  deviceLabel         String?       @map("device_label") @db.VarChar(255)
  enrolledAt          DateTime?     @map("enrolled_at")
  expiresAt           DateTime?     @map("expires_at")

  // existing deactivation tracking
  deactivatedAt       DateTime?     @map("deactivated_at")
  deactivatedById     BigInt?       @map("deactivated_by_id") @db.BigInt
  deactivateReason    String?       @map("deactivate_reason") @db.Text

  createdAt           DateTime      @default(now()) @map("created_at")
  updatedAt           DateTime      @updatedAt @map("updated_at")

  lurahProfile        LurahProfile  @relation(fields: [lurahProfileId], references: [id], onDelete: Cascade)
  signingSessions     SigningSession[]

  @@index([status])
  @@index([lurahProfileId])
  @@index([fingerprint])
  @@map("lurah_keys")
}
```

**B. Tambah model `SigningSession`:**

```prisma
enum SigningSessionStatus {
  PENDING
  COMPLETED
  EXPIRED
  REJECTED
}

model SigningSession {
  id              BigInt    @id @default(autoincrement()) @db.BigInt
  submissionId    BigInt    @map("submission_id") @db.BigInt
  lurahProfileId  BigInt    @map("lurah_profile_id") @db.BigInt
  keyId           BigInt    @map("key_id") @db.BigInt          // FK ke LurahKey
  dataToSign      String    @map("data_to_sign") @db.Text       // canonical JSON v2.0
  bodyHash        String    @map("body_hash") @db.VarChar(64)
  pdfDraftPath    String    @map("pdf_draft_path") @db.VarChar(255)
  letterNumber    String    @map("letter_number") @db.VarChar(100)
  verificationCode String   @map("verification_code") @db.VarChar(50)
  preparedAt      DateTime  @default(now()) @map("prepared_at")
  expiresAt       DateTime  @map("expires_at")
  status          SigningSessionStatus @default(PENDING)
  completedAt     DateTime? @map("completed_at")

  submission      Submission   @relation(fields: [submissionId], references: [id], onDelete: Cascade)
  lurahKey        LurahKey     @relation(fields: [keyId], references: [id])

  @@index([submissionId])
  @@index([expiresAt, status])
  @@map("signing_sessions")
}
```

**C. Modifikasi `Submission` (tambah relasi):**

```prisma
model Submission {
  // ... existing fields ...
  signingSessions SigningSession[]
}
```

**D. Update `IssuedLetter`:** Tidak perlu kolom baru. `signatureKeyId` dan `signedBy` sudah memadai.

Jalankan:
```bash
npx prisma migrate dev --name v2_mobile_key
npx prisma generate
```

**Acceptance:**
- [ ] Migrasi sukses tanpa error
- [ ] Tabel `signing_sessions` ada
- [ ] `lurah_keys` punya kolom `certificate_pem`, `serial_number`, `fingerprint`, `device_label`, `enrolled_at`, `expires_at`
- [ ] `lurah_keys.encrypted_private_key` jadi nullable
- [ ] Surat lama (v1.1) di `issued_letters` masih bisa diquery tanpa error

### Step 3: Implementasi `ca.service.js` & `enrollment.service.js`

Install deps:
```bash
npm install node-forge
```

**`src/services/ca.service.js`** — exports:
- `loadRootCa()` → cache `{ certPem, privateKey }` di memory (dekripsi sekali saat startup pakai `ROOT_CA_KEY_PASSPHRASE`)
- `signCsr(csrPem, { commonName, validityDays = 365 * 3 })` → return `{ certificatePem, serialNumber, fingerprint, issuedAt, expiresAt }`
- `getRootCaPem()` → return `certPem`

**`src/services/enrollment.service.js`** — exports:
- `createEnrollmentToken(lurahUserId, deviceLabel)` → return `{ token, expiresAt, subjectTemplate }`. Token disimpan in-memory cache (Map dengan TTL) atau Redis jika tersedia; jangan ke DB.
- `validateEnrollmentToken(token, lurahUserId)` → throw jika invalid/expired
- `enrollCertificate({ lurahUserId, token, csrPem, deviceLabel })`:
  1. Validate token
  2. Parse CSR dengan `node-forge`, verify signature CSR
  3. Validate subject match template
  4. Cek `LurahKey` aktif yang sudah punya `certificatePem` non-null — jika ada, throw `ALREADY_ENROLLED`
  5. Lookup `LurahProfile` aktif
  6. Sign CSR via `caService.signCsr`
  7. Insert `LurahKey` baru: `publicKey` dari CSR, `certificatePem`, `serialNumber`, `fingerprint`, `deviceLabel`, `enrolledAt`, `expiresAt`, `encryptedPrivateKey: null`, `status: 'ACTIVE'`
  8. Return record
- `rotateCertificate(...)` — sama dengan enroll, tapi `markActiveKeyRevoked('ROUTINE_ROTATION')` dulu sebelum insert.

**`src/services/crypto.service.js` perubahan:**
- Tambah `buildCanonicalDataV2(letterData, issuerData, metadata)` — sama dengan v1.1 tapi `version: "2.0"` dan tambah `signer_certificate_fingerprint` di metadata.
- Tambah `verifySignatureFromCertificate(canonicalString, signatureBase64, certificatePem)` — extract public key dari cert, verify signature.
- Tambah `verifyCertChain(certificatePem)` — verify cert ditandatangani Root CA + cek expiry. Return `{ valid, reason, signerCommonName }`.
- **Hapus** fungsi yang sudah tidak dipakai: `encryptPrivateKey`, `decryptPrivateKey`, `changePassphrase`, `generateLurahKey`, `createLetterSignature`, `getLurahKey`, `deactivateKeysForUser` (kalau tidak dipakai modul lain — cek dulu).

**Acceptance:**
- [ ] Unit test `caService.signCsr` — generate CSR test, sign, verify chain dengan `openssl verify`
- [ ] Unit test `enrollmentService.enrollCertificate` — sukses path + duplicate active key path
- [ ] Unit test `cryptoService.verifyCertChain` — valid cert pass, expired cert fail, cert from other CA fail

### Step 4: Implementasi `signing.service.js` + Refactor `letter.service.js`

**`src/services/signing.service.js`** — exports:
- `prepareSigning({ submissionId, lurahUserId, note, keterangan })`:
  1. Lookup submission, validate status `pending_lurah`
  2. Lookup `LurahKey` aktif yang `certificate_pem IS NOT NULL` — jika tidak ada, throw `ENROLLMENT_REQUIRED`
  3. Call `letterService.prepareLetterDraft(submission, key, { note, keterangan })` → return draft `{ canonicalData, bodyHash, pdfBuffer, pdfDraftPath, letterNumber, verificationCode }`
  4. Insert `SigningSession` (TTL 5 menit)
  5. Return `{ sessionId, expiresAt, pdfBase64, dataToSign, bodyHash, preview }`
- `submitSignature({ sessionId, signatureBase64, lurahUserId })`:
  1. Lookup session, validate PENDING + not expired + owner match
  2. Lookup `LurahKey` via `session.keyId`, validate status ACTIVE
  3. Verify signature: `cryptoService.verifySignatureFromCertificate(session.dataToSign, signatureBase64, key.certificatePem)`
  4. Verify cert chain: `cryptoService.verifyCertChain(key.certificatePem)`
  5. Call `letterService.finalizeIssuedLetter(session, signatureBase64, key)` → embed signature ke PDF draft, save, insert `IssuedLetter`, update submission
  6. Mark session `COMPLETED`
  7. Return finalized letter data
- `expireOldSessions()` — cron job (Step 8).

**`src/services/letter.service.js` refactor:**
- Pecah `issueLetter` jadi:
  - `prepareLetterDraft({ submission, lurahKey, note, keterangan })`:
    - PHASE 1: generate letter identity (reuse existing `generateLetterIdentity`)
    - PHASE 2: render HTML → raw PDF buffer
    - PHASE 3: compute body_hash
    - PHASE 4: build canonical v2.0 dengan `cryptoService.buildCanonicalDataV2`
    - Simpan draft PDF ke `public/letters/draft/<verificationCode>.pdf`
    - Return `{ canonicalData, bodyHash, pdfDraftPath, letterNumber, verificationCode, issuedDate, signedAtPlaceholder }` (signedAt diisi saat finalize)
  - `finalizeIssuedLetter({ session, signatureBase64, lurahKey })`:
    - Re-load PDF draft dari `session.pdfDraftPath`
    - PHASE 5: embed metadata via `pdfService.finalizeSignedPdf` dengan `signatureData = { canonicalData: session.dataToSign, signature: signatureBase64, canonicalHash: hashCanonicalData(dataToSign), signatureKeyId: lurahKey.id, algorithm: 'SHA256withRSA', publicKeyFingerprint: ... }`
    - PHASE 6: pindah file dari `draft/` ke `public/letters/`
    - PHASE 7: insert `IssuedLetter`, create `SubmissionApproval`, update submission status `pending_lurah` → `approved`, dalam 1 transaksi
- **Hapus** `issueLetter` lama. Pastikan tidak ada caller eksisting yang masih panggil (grep dulu).

**Acceptance:**
- [ ] Unit test `prepareLetterDraft` — draft PDF terbentuk, canonical valid JSON, body_hash deterministik
- [ ] Unit test `finalizeIssuedLetter` — letter terbit, signature di-embed di PDF, submission status berubah
- [ ] Unit test `signingService.submitSignature` — invalid signature reject, expired session reject (410), cert revoked reject (403)

### Step 5: Update Controllers & Routes

**[src/controllers/key.controller.js](src/controllers/key.controller.js):**
- **Hapus** `generateKey` handler.
- **Tambah** `requestEnrollmentToken`, `submitCsr`, `getCertificate`, `rotateKey`.
- **Update** `getCurrentPublicKey` dan `getPublicKeyByLetter` untuk include `certificatePem` + `rootCaCertificatePem` di response.
- Pertahankan `getKeyStatus`, `listKeys`, `revokeKey` (response cert diperluas).

**[src/controllers/submission.controller.js](src/controllers/submission.controller.js):**
- **Hapus** `approveByLurah` handler (atau ubah jadi handler yang langsung return 410 Gone — pilih sesuai pola tim).
- **Tambah** `prepareSigning`, `submitSignature`. Handler tipis — translate `req.user.userId` + params → service call, format response sesuai [API_CONTRACTS.md](API_CONTRACTS.md).

**[src/routes/key.routes.js](src/routes/key.routes.js):**
```js
// HAPUS:
// router.post('/generate', requireRole('lurah'), keyController.generateKey.bind(keyController));

// TAMBAH (di blok authenticated, requireRole('lurah')):
router.post('/enrollment-token', requireRole('lurah'), keyController.requestEnrollmentToken.bind(keyController));
router.post('/csr', requireRole('lurah'), keyController.submitCsr.bind(keyController));
router.get('/certificate', requireRole('lurah'), keyController.getCertificate.bind(keyController));
router.post('/rotate', requireRole('lurah'), keyController.rotateKey.bind(keyController));
```

**[src/routes/submission.routes.js](src/routes/submission.routes.js):**
```js
// HAPUS:
// router.post('/:id/lurah/approve', requireRole('lurah', 'sekertaris'), submissionController.approveByLurah.bind(submissionController));

// TAMBAH:
router.post('/:id/lurah/prepare-signing', requireRole('lurah'), submissionController.prepareSigning.bind(submissionController));
router.post('/:id/lurah/submit-signature', requireRole('lurah'), submissionController.submitSignature.bind(submissionController));
```

Catatan: role `sekertaris` di endpoint approve lama **dihapus**. Sekertaris tidak punya hardware key, jadi tidak bisa sign di v2.0. Jika sekertaris perlu lihat antrian, mereka tetap bisa pakai `GET /v1/submissions/lurah/list` (role allow `lurah, sekertaris`) — read-only.

**Acceptance:**
- [ ] `npm run lint` pass
- [ ] Manual test via Postman:
  - [ ] `POST /v1/keys/generate` return 404 (route hilang)
  - [ ] `POST /v1/submissions/:id/lurah/approve` return 404 atau 410
  - [ ] `POST /v1/keys/enrollment-token` return 200 dengan token (auth lurah)
  - [ ] `POST /v1/submissions/:id/lurah/prepare-signing` return 200 dengan `pdfBase64` (setelah lurah enrollment)

### Step 6: Update `verification.service.js`

Tambah trust check sebelum decide result:

```js
async runTrustCheck(metadata, issuedLetter, cryptoResult) {
  // Jika cryptoCheck sudah fail, skip trust check (tidak relevan)
  if (!cryptoResult.pass) {
    return { pass: false, skipped: true, reason: 'Skipped (crypto check failed)' };
  }

  const keyRecord = await this.resolveKey(metadata, issuedLetter);
  if (!keyRecord?.certificatePem) {
    // Surat v1.1 — tidak ada cert, trust diasumsikan bila key terdaftar
    return { pass: true, legacy: true, reason: 'Legacy v1.1 letter (no certificate)' };
  }

  const result = cryptoService.verifyCertChain(keyRecord.certificatePem);
  return {
    pass: result.valid,
    reason: result.reason,
    signerCommonName: result.signerCommonName,
  };
}
```

Update `decideVerificationResult` di [src/services/verification.service.js:372-421](src/services/verification.service.js#L372-L421):

```js
// Setelah server+crypto+body pass, cek trust:
if (serverStatus === 'pass' && cryptoPass && bodyPass) {
  if (!trustResult.pass) {
    return { valid: false, status: 'UNTRUSTED_SIGNER', message: 'Sertifikat penanda tangan tidak terverifikasi' };
  }
  return { valid: true, status: 'VALID', message: 'Surat valid' };
}
```

Tambahkan `trustCheck` ke response object di `verifyLetter()` dan `verifyLetterByCode()`.

**Acceptance:**
- [ ] Surat v1.1 lama tetap VALID di verifier (legacy path)
- [ ] Surat v2.0 dengan cert valid → VALID
- [ ] Surat dengan cert dari CA lain (mocked) → UNTRUSTED_SIGNER
- [ ] Surat dengan cert expired → UNTRUSTED_SIGNER

### Step 7: Mobile Implementation

(Di luar scope backend; lihat folder `android/` untuk reference.)

Catatan integrasi backend:
- Base URL Retrofit: gunakan `BuildConfig.API_BASE_URL` + `/v1`
- Mobile harus simpan `rootCaCertificatePem` dari response `/v1/keys/csr` ke EncryptedSharedPreferences — dipakai untuk pinning + offline verification
- Saat `prepare-signing` return `pdfBase64` + `bodyHash`, mobile WAJIB recompute hash dari `pdfBase64` dan bandingkan; jika beda → tolak signing (deteksi server malicious)

### Step 8: Background Jobs & Operasional

1. **Cleanup expired signing sessions** — buat `src/jobs/cleanupSessions.js`, dipanggil cron (mis. setiap 5 menit). Set status `EXPIRED` untuk session dengan `expires_at < now()` dan `status='PENDING'`. Hapus file di `public/letters/draft/` yang sudah > 1 jam.
2. **Cleanup draft PDFs** — saat `submitSignature` sukses atau session expired, hapus file draft.
3. **Audit log** — tambah `audit_logs` table opsional, atau gunakan winston/pino dengan structured JSON. Log events: `enrollment_created`, `enrollment_completed`, `signing_session_created`, `signing_completed`, `signature_invalid`, `cert_revoked`.
4. **Rate limiting** — tambah `express-rate-limit` dengan limit di [API_CONTRACTS.md Section 7](API_CONTRACTS.md).

### Step 9: End-to-End Testing

Test environment:
1. Run server dengan `.env.development`, bootstrap Root CA di `secure-storage/`
2. Bootstrap test Lurah + LurahProfile aktif di DB
3. Start Android emulator dengan biometric enabled
4. Install app, login Lurah

**Test Scenarios:**

| ID | Scenario | Expected |
|---|---|---|
| E2E-01 | Cold start enrollment | `LurahKey` row baru dengan cert, key id tersimpan di EncryptedSharedPreferences |
| E2E-02 | Sign satu surat | `IssuedLetter` terbit, signature di-embed, verifier `/v1/verify` return VALID |
| E2E-03 | Biometric denied di mobile | Backend tidak menerima request submit; session tetap PENDING |
| E2E-04 | Session expired (>5 menit) | `submit-signature` → 410 Gone, session marked EXPIRED |
| E2E-05 | Modify PDF post-signing (ubah 1 byte) | Verifier → BODY_MODIFIED |
| E2E-06 | Submit signature dengan key yang tidak match dataToSign | 400 Bad Request `SIGNATURE_INVALID` |
| E2E-07 | Prepare-signing sebelum enrollment | 412 Precondition Failed |
| E2E-08 | Cert expired di server (mocked dengan expiresAt mundur) | submit-signature → 403, prepare-signing → 412 |
| E2E-09 | Revoke cert di tengah signing session | submit-signature → 403 |
| E2E-10 | Network failure di submit-signature | App retry; session masih valid jika dalam TTL |
| E2E-11 | Surat v1.1 lama diverifikasi di v2.0 verifier | VALID dengan legacy trustCheck |
| E2E-12 | Surat dengan cert dari CA lain (mocked) | UNTRUSTED_SIGNER |

### Step 10: Migrasi Data Production

Karena clean break, hari migrasi:
1. **Sebelum cutover:** stop terbitkan surat baru via flow lama (announcement ke Lurah).
2. **Migrasi DB:** jalankan `prisma migrate deploy`. Kolom `encrypted_private_key` jadi nullable, data eksisting tidak hilang.
3. **Bootstrap Root CA di production:** `node scripts/bootstrap-root-ca.js`, backup offline.
4. **Lurah re-enrollment:** Lurah install app baru, lakukan enrollment. Cert baru tersimpan, key lama (`LurahKey` row dengan `encryptedPrivateKey`) di-set `status='INACTIVE'` (manual via admin) atau biarkan ACTIVE untuk verifikasi surat historis.
5. **Resume terbit surat** via flow v2.0.

---

## 4. Master Acceptance Checklist

### Crypto correctness
- [ ] Mobile bisa generate RSA-2048 keypair di Android Keystore
- [ ] CSR dari mobile bisa di-parse server, signature CSR valid
- [ ] Cert ditandatangani Root CA, chain valid via `openssl verify`
- [ ] Signature dari mobile bisa diverifikasi server dengan `certificatePem`
- [ ] Tampering PDF post-signing terdeteksi (BODY_MODIFIED)
- [ ] Tampering canonical metadata terdeteksi (CANONICAL_MODIFIED atau RECORD_MISMATCH)
- [ ] Cert chain trust check pass untuk cert dari Root CA, fail untuk cert lain (UNTRUSTED_SIGNER)

### Security boundaries
- [ ] Private key Lurah tidak pernah keluar dari Android Keystore (verify via `KeyInfo.isInsideSecureHardware`)
- [ ] Server tidak punya endpoint untuk sign tanpa request dari mobile (semua signing path lama dihapus)
- [ ] Setiap signing operation memicu biometric prompt baru (per-operation auth)
- [ ] Signing session expire setelah 5 menit
- [ ] Cert yang revoked langsung tolak signing baru (status check di `submitSignature`)
- [ ] Root CA private key di-encrypt with passphrase, passphrase di env var, backup offline

### Workflow correctness
- [ ] Lurah baru hanya bisa enrollment sekali (kecuali rotate)
- [ ] Lurah lihat preview PDF sebelum biometric prompt
- [ ] Mobile recompute body_hash dari pdfBase64 dan compare dengan response (deteksi server malicious)
- [ ] Submission status pending_lurah → approved hanya setelah signature valid + finalize sukses
- [ ] Submission yang sudah `approved`/`issued` tidak bisa di-prepare-signing lagi
- [ ] Surat v1.1 historis tetap valid di verifier

### Operational
- [ ] Bootstrap script untuk Root CA terdokumentasi dengan langkah backup
- [ ] Cleanup job untuk expired sessions + draft PDFs jalan periodic
- [ ] Audit log records enrollment, signing, verification events
- [ ] Rate limiting di endpoint enrollment, submit-signature, verify
- [ ] Migration plan production didokumentasikan

---

## 5. Known Limitations

1. **Single device per Lurah** — Implementasi asumsikan satu Lurah punya satu device aktif. Multi-device handling adalah Pengembangan Lanjutan.
2. **Self-signed Root CA** — Adobe Reader akan tampilkan warning karena Root CA tidak di trust store global. Verifikasi via app/web dedicated tetap valid (Root CA terbungkus aplikasi).
3. **Manual revocation** — Tidak ada CRL/OCSP. Revocation cek via `LurahKey.status='REVOKED'`. Cukup untuk skala kelurahan tunggal.
4. **No PAdES compliance** — Format Info Dictionary custom (dipertahankan dari v1.1). Reader PDF standar tidak mengenali sebagai signed.
5. **Online signing only** — Lurah harus online untuk prepare-signing dan submit-signature. Offline approval tidak supported.
6. **No timestamping service (TSA)** — `signed_at` dari server clock. Pengembangan Lanjutan.
7. **Sekertaris tidak bisa sign** — Karena tidak punya mobile key terdaftar. Jika ingin sekertaris sign-on-behalf, perlu enrollment terpisah dengan cert sekertaris (out of scope).

---

## 6. AI Agent Execution Instructions

Untuk agent yang implement plan ini:

1. **Baca [API_CONTRACTS.md](API_CONTRACTS.md) bersama plan ini.** API_CONTRACTS adalah source of truth untuk request/response shape.
2. **Eksekusi step-by-step sesuai Section 3.** Step 2 (schema) harus selesai sebelum Step 3 (services).
3. **Setiap step punya acceptance criteria.** Verify sebelum lanjut step berikut.
4. **Jangan touch file di luar daftar Section 2.1/2.2.** Modul `submission.service.js`, `auth.service.js`, `notification.service.js`, dll. tidak boleh dimodifikasi tanpa diskusi.
5. **File code Android di folder `android/` adalah reference, bukan untuk dipindahkan ke repo backend ini.** Backend repo hanya berisi Node.js code.
6. **Setelah Step 4 (services) dan Step 6 (verification update), minta review user sebelum lanjut.** Ini titik kritis di mana logic signing direwrite.
7. **Jangan delete `LurahKey.encryptedPrivateKey` column.** Hanya jadikan nullable. Data historis harus tetap utuh.
8. **Verify versi `node-forge`** dengan `npm view node-forge versions` sebelum install. Targetkan versi stable terakhir.
9. **Setiap perubahan endpoint wajib di-update juga di [swagger.yaml](swagger.yaml)** (Step terpisah setelah backend selesai).

---

## Appendix: File Manifest

```
api-e-kelurahan-talete-satu/
├── MOBILE_KEY_IMPLEMENTATION_PLAN.md   ← file ini
├── API_CONTRACTS.md                     ← request/response contracts
├── scripts/
│   └── bootstrap-root-ca.js             ← BARU
├── secure-storage/                       ← BARU, gitignored
│   ├── root-ca-cert.pem
│   └── root-ca-key.pem
├── prisma/
│   └── schema.prisma                    ← UPDATE: LurahKey + SigningSession
├── src/
│   ├── config/
│   │   └── env.js                       ← UPDATE: tambah ROOT_CA_* env
│   ├── services/
│   │   ├── ca.service.js                ← BARU
│   │   ├── enrollment.service.js        ← BARU
│   │   ├── signing.service.js           ← BARU
│   │   ├── crypto.service.js            ← UPDATE: hapus signing helpers, tambah cert verify
│   │   ├── letter.service.js            ← UPDATE: pecah issueLetter
│   │   ├── pdf.service.js               ← UPDATE: terima signature param
│   │   └── verification.service.js      ← UPDATE: trust check
│   ├── controllers/
│   │   ├── key.controller.js            ← UPDATE
│   │   └── submission.controller.js     ← UPDATE
│   ├── routes/
│   │   ├── key.routes.js                ← UPDATE
│   │   └── submission.routes.js         ← UPDATE
│   └── jobs/
│       └── cleanupSessions.js           ← BARU
└── android/                              ← Reference (di-deploy ke repo mobile terpisah)
    ├── crypto/...
    ├── data/...
    └── ui/...
```
