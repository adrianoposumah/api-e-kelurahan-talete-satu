# REST API Contracts — Mobile Key Architecture v2.0

Dokumentasi endpoint backend e-Kelurahan untuk arsitektur mobile-stored key. Dokumen ini menyesuaikan format dan path dengan API eksisting sistem (Express v5, prefix `/v1`).

**Base URL:** `http://localhost:5000/v1` (development) atau `${BASE_URL}/v1` (lihat `src/config/env.js`).

**Auth:** Bearer JWT pada header `Authorization: Bearer <token>` kecuali ditandai PUBLIC. Token diverifikasi oleh [src/middleware/auth.middleware.js](src/middleware/auth.middleware.js) dan menempelkan `req.user = { userId, role, ... }`.

**Content-Type:** `application/json` kecuali endpoint upload PDF (`multipart/form-data`).

**Response envelope (mengikuti pola eksisting):**

- Sukses (object):
  ```json
  { "success": true, "data": { ... } }
  ```
  atau (action):
  ```json
  { "message": "...", "data": { ... } }
  ```
- Sukses (list):
  ```json
  { "data": [ ... ], "pagination": { "page": 1, "limit": 10, "total": 0, "total_pages": 0 } }
  ```
- Error:
  ```json
  { "error": "Bad Request", "message": "human-readable description" }
  ```
  Beberapa endpoint lama mengembalikan `{ "success": false, "message": "..." }`; pertahankan pola yang dipakai modul induknya.

---

## 1. Auth (Eksisting — Tidak Diubah)

`POST /v1/auth/login`, `POST /v1/auth/refresh`, dst. Sudah didefinisikan di [swagger.yaml](swagger.yaml). Lurah login pakai endpoint yang sama dengan role `lurah`.

---

## 2. Enrollment Endpoints (Lurah Mobile)

Digunakan aplikasi mobile Lurah saat pertama kali install untuk mendaftarkan public key + menerima sertifikat X.509 dari Root CA server. Routes ditempel di [src/routes/key.routes.js](src/routes/key.routes.js).

### POST `/v1/keys/enrollment-token`

Initiate enrollment session. Server return token yang harus disertakan saat submit CSR. Token ini singkat-umur (TTL 10 menit).

**Auth:** Lurah JWT (`role=lurah`).

**Body:** Kosong (atau optional `{ "deviceLabel": "string" }`).

**Response 200:**
```json
{
  "success": true,
  "data": {
    "enrollmentToken": "string",
    "expiresAt": "2026-05-25T12:10:00.000Z",
    "subjectTemplate": {
      "commonName": "Lurah Talete Satu",
      "organization": "Kelurahan Talete Satu",
      "organizationalUnit": "Pemerintah Kota Tomohon",
      "country": "ID"
    }
  }
}
```

**Response 409 — Sudah punya cert aktif:**
```json
{
  "error": "Conflict",
  "message": "Lurah sudah memiliki key/cert aktif. Lakukan revoke atau rotate dulu.",
  "data": { "activeKeyId": "123", "issuedAt": "2026-01-01T00:00:00.000Z" }
}
```

### POST `/v1/keys/csr`

Submit PKCS#10 CSR untuk di-sign menjadi sertifikat X.509 oleh Root CA server.

**Auth:** Lurah JWT.

**Body:**
```json
{
  "enrollmentToken": "string dari endpoint sebelumnya",
  "csrPem": "-----BEGIN CERTIFICATE REQUEST-----\n...\n-----END CERTIFICATE REQUEST-----",
  "deviceLabel": "HP Dinas Lurah (optional)"
}
```

**Response 201:**
```json
{
  "success": true,
  "message": "Sertifikat berhasil diterbitkan",
  "data": {
    "keyId": "123",
    "certificatePem": "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----",
    "rootCaCertificatePem": "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----",
    "serialNumber": "01A2B3C4...",
    "fingerprint": "SHA256 hex",
    "algorithm": "RSA-SHA256",
    "issuedAt": "2026-05-25T12:00:00.000Z",
    "expiresAt": "2029-05-25T12:00:00.000Z"
  }
}
```

**Error responses:**

| HTTP | `error` | `message` |
|---|---|---|
| 400 | `Bad Request` | `CSR signature tidak valid atau format malformed` |
| 400 | `Bad Request` | `Subject CSR tidak match template enrollment` |
| 410 | `Gone` | `Enrollment token sudah expired` |
| 409 | `Conflict` | `Lurah sudah memiliki key aktif. Revoke dulu.` |

### GET `/v1/keys/certificate`

Ambil sertifikat aktif untuk Lurah yang authenticated (mobile pakai endpoint ini untuk reload cert lokal).

**Auth:** Lurah JWT.

**Response 200:**
```json
{
  "success": true,
  "data": {
    "keyId": "123",
    "certificatePem": "-----BEGIN CERTIFICATE-----...",
    "rootCaCertificatePem": "-----BEGIN CERTIFICATE-----...",
    "serialNumber": "01A2B3C4...",
    "fingerprint": "SHA256 hex",
    "deviceLabel": "HP Dinas Lurah",
    "algorithm": "RSA-SHA256",
    "status": "ACTIVE",
    "issuedAt": "2026-05-25T12:00:00.000Z",
    "expiresAt": "2029-05-25T12:00:00.000Z"
  }
}
```

**Response 404:**
```json
{
  "error": "Not Found",
  "message": "Lurah belum melakukan enrollment"
}
```

### GET `/v1/keys/status` (Eksisting — Tetap)

Sudah didefinisikan di [src/controllers/key.controller.js:174-201](src/controllers/key.controller.js#L174-L201). Tetap dipertahankan, return `{ success, has_active_key, data }`. Mobile dapat memakai endpoint ini sebagai cek ringan sebelum panggil `/certificate`.

---

## 3. Public Key / Certificate Endpoints (Verifier)

### GET `/v1/keys/active` (PUBLIC — Eksisting, response diperluas)

Tetap dipertahankan. Setelah migrasi v2.0, response berisi cert + chain.

**Response 200:**
```json
{
  "success": true,
  "data": {
    "id": "123",
    "publicKey": "-----BEGIN PUBLIC KEY-----...",
    "certificatePem": "-----BEGIN CERTIFICATE-----...",
    "rootCaCertificatePem": "-----BEGIN CERTIFICATE-----...",
    "algorithm": "RSA-SHA256",
    "createdAt": "2026-05-25T12:00:00.000Z",
    "expiresAt": "2029-05-25T12:00:00.000Z",
    "signer": {
      "nama": "Lurah Talete Satu",
      "nip": "1234567890",
      "jabatan": "Lurah"
    }
  }
}
```

### GET `/v1/keys/public/:verificationCode` (PUBLIC — Eksisting, response diperluas)

Tetap dipertahankan. Response tambahkan `certificatePem` dan `rootCaCertificatePem` agar verifier eksternal bisa membangun trust chain tanpa request kedua.

---

## 4. Signing Workflow Endpoints

Lurah lihat daftar tugas tanda tangan via endpoint submission **yang sudah ada**, lalu jalankan flow 2 fase: prepare-signing → submit-signature.

### GET `/v1/submissions/lurah/list` (Eksisting — Tidak Diubah)

Sudah ada di [src/routes/submission.routes.js:48](src/routes/submission.routes.js#L48). Lurah pakai endpoint ini dengan `status=pending_lurah` untuk daftar tugas pending. Tidak perlu endpoint baru.

### GET `/v1/submissions/lurah/:id` (Eksisting — Tidak Diubah)

Detail submission untuk review. Sudah ada di [src/routes/submission.routes.js:54](src/routes/submission.routes.js#L54).

### POST `/v1/submissions/:id/lurah/prepare-signing` (BARU)

Server render draft PDF, build canonical data v2.0 dengan body_hash, simpan ke `signing_sessions`, kembalikan data untuk ditandatangani mobile. **Endpoint ini tidak finalize letter** — letter baru terbit setelah signature dari mobile masuk.

**Auth:** Lurah JWT (`role=lurah`).

**Body:** Kosong, atau optional:
```json
{ "note": "string (catatan approval)", "keterangan": "string (deskripsi tambahan untuk letter)" }
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "sessionId": "456",
    "expiresAt": "2026-05-25T12:05:00.000Z",
    "pdfBase64": "JVBERi0xLjQK...",
    "dataToSign": "{\"version\":\"2.0\",\"type\":\"domisili\",...}",
    "bodyHash": "sha256hex...",
    "preview": {
      "letterNumber": "AB12CD34-001/2009/SKD/V/2026",
      "verificationCode": "AB12CD34-001",
      "issuedDate": "2026-05-25T12:00:00.000Z",
      "expiresAt": "2026-08-25T12:00:00.000Z"
    }
  }
}
```

**Catatan:**
- `dataToSign` adalah canonical JSON deterministik versi `"2.0"` (lihat [Section 8](#8-canonical-data-v20)).
- `bodyHash` dapat diverifikasi mobile dengan men-compute hash dari `pdfBase64` (mencegah server berbohong).
- Format `letterNumber` dan `verificationCode` mengikuti generator eksisting di [src/services/letter.service.js:43-88](src/services/letter.service.js#L43-L88) (tidak diubah).

**Error responses:**

| HTTP | `error` | `message` |
|---|---|---|
| 404 | `Not Found` | `Submission tidak ditemukan` |
| 409 | `Conflict` | `Submission tidak dalam status pending_lurah` |
| 409 | `Conflict` | `Surat sudah pernah diterbitkan` |
| 412 | `Precondition Failed` | `Lurah belum melakukan enrollment` |

### POST `/v1/submissions/:id/lurah/submit-signature` (BARU)

Mobile kirim signature yang dihasilkan Android Keystore. Server validate dan finalize letter.

**Auth:** Lurah JWT (`role=lurah`).

**Body:**
```json
{
  "sessionId": "456",
  "signatureBase64": "base64 encoded RSA signature"
}
```

**Response 200:**
```json
{
  "message": "Submission berhasil disetujui dan surat telah diterbitkan",
  "data": {
    "submission": { ... },
    "letter": {
      "letter_number": "AB12CD34-001/2009/SKD/V/2026",
      "verification_code": "AB12CD34-001",
      "verification_url": "https://verify.example.com/letters?code=AB12CD34-001",
      "pdf_path": "/public/letters/AB12CD34-001.pdf",
      "signed_at": "2026-05-25T12:02:30.000Z",
      "expires_at": "2026-08-25T12:00:00.000Z"
    }
  }
}
```

Catatan: response data shape ini sengaja menyerupai response endpoint approve eksisting agar konsumer dashboard tidak perlu refactor besar.

**Error responses:**

| HTTP | `error` | `message` |
|---|---|---|
| 400 | `Bad Request` | `Signature tidak valid untuk dataToSign yang diberikan` |
| 410 | `Gone` | `Signing session sudah lewat 5 menit. Mulai ulang dari prepare-signing.` |
| 409 | `Conflict` | `Signing session sudah pernah selesai` |
| 409 | `Conflict` | `Surat sudah pernah diterbitkan` |
| 403 | `Forbidden` | `Sertifikat penanda tangan sudah revoked` |

### POST `/v1/submissions/:id/lurah/reject` (Eksisting — Tidak Diubah)

Sudah ada di [src/routes/submission.routes.js:71](src/routes/submission.routes.js#L71). Tidak perlu dibuat ulang.

### POST `/v1/submissions/:id/lurah/approve` (DEPRECATED — Dihapus)

Endpoint server-side signing v1.1 yang memakai `passphrase` di body **dihapus total** di v2.0. Permintaan ke endpoint ini akan return:

```json
{
  "error": "Gone",
  "message": "Endpoint ini sudah tidak didukung. Gunakan /v1/submissions/:id/lurah/prepare-signing + /submit-signature."
}
```
HTTP 410.

---

## 5. Verification Endpoints (Eksisting — Truth Table Diperluas)

Endpoint **tidak berubah**. Hanya logika di [src/services/verification.service.js](src/services/verification.service.js) yang dirombak untuk:
1. Memvalidasi cert chain ke Root CA (`trust` check).
2. Menambah status `UNTRUSTED_SIGNER` saat cert tidak terbit oleh Root CA atau sudah expired.

### POST `/v1/verify`

Upload PDF, multipart `file`. Sudah didefinisikan di [src/routes/verification.routes.js:46](src/routes/verification.routes.js#L46).

**Response 200 (struktur sudah ada, hanya tambah `trustCheck`):**
```json
{
  "valid": true,
  "status": "VALID",
  "message": "Surat valid",
  "serverCheck": { "pass": true, "status": "pass", "reason": "..." },
  "cryptoCheck": { "pass": true, "reason": "...", "keyStatus": "ACTIVE" },
  "bodyCheck":   { "pass": true, "reason": "..." },
  "trustCheck":  { "pass": true, "reason": "Cert chain terverifikasi ke Root CA", "signerCommonName": "Lurah Talete Satu" },
  "letter": { "letterNumber": "...", "letterType": "...", "issuedAt": "..." }
}
```

Status set yang dapat muncul: `VALID`, `BODY_MODIFIED`, `CANONICAL_MODIFIED`, `TAMPERED`, `REVOKED`, `EXPIRED`, `FAKE`, `NOT_REGISTERED`, `NOT_APPROVED`, `RECORD_MISMATCH`, `MALFORMED`, `EXPIRED_AND_MODIFIED`, `REVOKED_AND_MODIFIED`, `UNTRUSTED_SIGNER` (baru di v2.0).

### GET `/v1/verify/code/:verificationCode` & GET `/v1/letters/verify/:code`

Eksisting. Response mengikuti pola yang sama dengan tambahan `trustCheck`.

---

## 6. Lifecycle Endpoints

### POST `/v1/keys/rotate` (BARU)

Lurah mau ganti device. Generate cert baru, key lama otomatis di-set `status=REVOKED` dengan `deactivateReason='ROUTINE_ROTATION'`.

**Auth:** Lurah JWT.

**Body:**
```json
{
  "enrollmentToken": "string (request via /enrollment-token dulu)",
  "csrPem": "-----BEGIN CERTIFICATE REQUEST-----...",
  "deviceLabel": "HP Baru Lurah"
}
```

**Response 201:** Sama dengan `POST /v1/keys/csr`.

### POST `/v1/keys/:id/revoke` (Eksisting — Tidak Diubah)

Sudah ada di [src/routes/key.routes.js:30](src/routes/key.routes.js#L30). Admin-only. Tidak perlu dibuat ulang.

**Catatan:** Surat yang sudah terbit sebelum revoke tetap `VALID` di verifier (signature mathematically correct, signed_at < revoke time). Verifier menampilkan note di `cryptoCheck.reason` saat keyStatus = REVOKED.

---

## 7. Rate Limiting (Rekomendasi)

Belum diimplementasi di sistem eksisting. Saat dipasang, gunakan limits berikut (per Lurah userId, kecuali public):

| Endpoint | Limit |
|---|---|
| `POST /v1/auth/login` | 5 / menit / IP |
| `POST /v1/keys/csr` | 3 / hari / Lurah |
| `POST /v1/keys/enrollment-token` | 5 / hari / Lurah |
| `POST /v1/submissions/*/lurah/prepare-signing` | 30 / menit / Lurah |
| `POST /v1/submissions/*/lurah/submit-signature` | 30 / menit / Lurah |
| `POST /v1/verify` (public) | 60 / menit / IP |
| `GET /v1/verify/code/*` (public) | 60 / menit / IP |

Response 429:
```json
{ "error": "Too Many Requests", "message": "Terlalu banyak request. Coba lagi nanti." }
```
Header `Retry-After: <seconds>`.

---

## 8. Canonical Data v2.0

Field order dipertahankan deterministik. Bedanya dengan v1.1: hanya `version` (`"1.1"` → `"2.0"`) dan tambahan `signer_certificate_fingerprint`.

```json
{
  "version": "2.0",
  "type": "domisili",
  "nomor_surat": "AB12CD34-001/2009/SKD/V/2026",
  "nama": "John Doe",
  "nik": "7171...",
  "tanggal_lahir": "1990-01-01",
  "lingkungan": "I",
  "tujuan": "Mengurus KTP baru",
  "issued_date": "2026-05-25T12:00:00.000Z",
  "signed_at": "2026-05-25T12:02:30.000Z",
  "body_hash": "sha256hex...",
  "issuer": {
    "nama_lurah": "Lurah Talete Satu",
    "nip_lurah": "1234567890",
    "kelurahan": "Talete Satu",
    "kecamatan": "Tomohon Tengah",
    "kota": "Tomohon"
  },
  "verification_code": "AB12CD34-001",
  "algorithm": "SHA256withRSA",
  "public_key_fingerprint": "AA:BB:CC:...",
  "signer_certificate_fingerprint": "SHA256 hex of X.509 cert"
}
```

Implementasi: extend `cryptoService.buildCanonicalData` di [src/services/crypto.service.js:461-496](src/services/crypto.service.js#L461-L496) dengan branch versi.

---

## 9. Standard Error Conventions

Ikuti pola eksisting: HTTP code + `{ error, message }` envelope. Kode `error` adalah string status (mis. `"Bad Request"`, `"Forbidden"`), bukan slug.

| HTTP | `error` | Konteks |
|---|---|---|
| 400 | `Bad Request` | Body validation, CSR invalid, signature invalid, subject mismatch |
| 401 | `Unauthorized` | JWT missing/expired |
| 403 | `Forbidden` | Role mismatch, cert revoked |
| 404 | `Not Found` | Resource tidak ada, cert belum di-enroll |
| 409 | `Conflict` | State transition invalid, sudah enrolled, session sudah selesai |
| 410 | `Gone` | Token/session expired, endpoint deprecated |
| 412 | `Precondition Failed` | Lurah belum enrollment saat ingin prepare-signing |
| 429 | `Too Many Requests` | Rate limit |
| 500 | `Internal Server Error` | Default fallback |

---

## 10. Migration Notes

| Sebelumnya (v1.1) | Setelah (v2.0) |
|---|---|
| `POST /v1/keys/generate` (passphrase) | Diganti dengan `enrollment-token` + `csr` flow. Endpoint `/generate` di-deprecate (return 410). |
| `POST /v1/submissions/:id/lurah/approve` body `{ passphrase, note, keterangan }` | Dihapus (410 Gone). Pakai `prepare-signing` + `submit-signature`. |
| `LurahKey.encryptedPrivateKey` selalu ada | Kolom jadi nullable. Untuk key baru v2.0, kolom ini `NULL`. |
| `version: "1.1"` di canonical | `version: "2.0"`. Verifier accept keduanya untuk surat historis. |
