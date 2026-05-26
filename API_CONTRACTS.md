# REST API Contracts — Mobile Key + PAdES v2.0

Dokumentasi endpoint backend e-Kelurahan untuk arsitektur mobile-stored key dengan standar **PAdES-B-B**. Dokumen ini mengikuti arahan PAdES di [BACKEND_INSTRUCTION.md](BACKEND_INSTRUCTION.md), tetapi tetap memakai route eksisting Express dengan prefix `/v1`.

**Base URL:** `http://localhost:5000/v1` (development) atau `${BASE_URL}/v1`.

**Auth:** Bearer JWT pada header `Authorization: Bearer <token>` kecuali endpoint yang ditandai PUBLIC. Token diverifikasi oleh [src/middleware/auth.middleware.js](src/middleware/auth.middleware.js) dan menempelkan `req.user = { userId, role, ... }`.

**Content-Type:** `application/json` kecuali endpoint upload PDF (`multipart/form-data`).

**Response envelope:** endpoint baru mengikuti pola eksisting project:

- Sukses object:
  ```json
  { "success": true, "data": { "...": "..." } }
  ```
- Sukses action:
  ```json
  { "message": "...", "data": { "...": "..." } }
  ```
- Sukses list:
  ```json
  { "data": [], "pagination": { "page": 1, "limit": 10, "total": 0, "total_pages": 0 } }
  ```
- Error standar:
  ```json
  { "error": "Bad Request", "message": "human-readable description" }
  ```

Beberapa endpoint lama masih mengembalikan `{ "success": false, "message": "..." }`; pertahankan pola modul induknya untuk backward compatibility.

---

## 1. Auth

`POST /v1/auth/login`, `POST /v1/auth/refresh`, `POST /v1/auth/logout`, dan endpoint auth lain tidak berubah. Lurah login memakai endpoint yang sama dengan role `lurah`.

---

## 2. Enrollment dan Certificate

Routes berada di [src/routes/key.routes.js](src/routes/key.routes.js).

### POST `/v1/keys/enrollment-token`

Membuat token singkat umur untuk submit CSR. TTL token adalah 10 menit.

**Auth:** Lurah JWT.

**Body enrollment awal:** kosong atau:
```json
{ "deviceLabel": "HP Dinas Lurah" }
```

**Body untuk rotasi device/key:**
```json
{ "purpose": "rotation" }
```

Jika `purpose` tidak dikirim, server menganggap token untuk enrollment awal dan akan menolak saat Lurah masih punya sertifikat aktif.

**Response 200:**
```json
{
  "success": true,
  "data": {
    "enrollmentToken": "string",
    "expiresAt": "2026-05-26T12:10:00.000Z",
    "subjectTemplate": {
      "commonName": "Lurah Talete Satu",
      "organization": "Kelurahan Talete Satu",
      "organizationalUnit": "Pemerintah Kota Tomohon",
      "country": "ID"
    }
  }
}
```

**Response 409 untuk enrollment awal saat sudah aktif:**
```json
{
  "error": "Conflict",
  "message": "Lurah sudah memiliki sertifikat aktif. Lakukan revoke atau rotate dulu.",
  "data": { "activeKeyId": "123", "issuedAt": "2026-01-01T00:00:00.000Z" }
}
```

**Response 412 untuk token rotasi tanpa sertifikat aktif:**
```json
{ "error": "Precondition Failed", "message": "Lurah belum memiliki sertifikat aktif untuk dirotasi" }
```

### POST `/v1/keys/csr`

Submit PKCS#10 CSR untuk enrollment awal. Server memvalidasi signature CSR, subject template, lalu menandatangani CSR memakai Root CA.

**Auth:** Lurah JWT.

**Body:**
```json
{
  "enrollmentToken": "token dari /keys/enrollment-token",
  "csrPem": "-----BEGIN CERTIFICATE REQUEST-----\n...\n-----END CERTIFICATE REQUEST-----",
  "deviceLabel": "HP Dinas Lurah"
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
    "fingerprint": "sha256 hex of DER cert",
    "algorithm": "RSA-SHA256",
    "issuedAt": "2026-05-26T12:00:00.000Z",
    "expiresAt": "2029-05-26T12:00:00.000Z"
  }
}
```

**Errors:**

| HTTP | `error` | `message` |
|---|---|---|
| 400 | `Bad Request` | `enrollmentToken dan csrPem wajib diisi` |
| 400 | `Bad Request` | `CSR signature tidak valid atau format malformed` |
| 400 | `Bad Request` | `Subject CSR tidak match ...` |
| 409 | `Conflict` | `Lurah sudah memiliki sertifikat aktif. Lakukan revoke atau rotate dulu.` |
| 410 | `Gone` | `Enrollment token sudah expired` |

### GET `/v1/keys/certificate`

Mengambil sertifikat aktif Lurah authenticated.

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
    "fingerprint": "sha256 hex",
    "deviceLabel": "HP Dinas Lurah",
    "algorithm": "RSA-SHA256",
    "status": "ACTIVE",
    "issuedAt": "2026-05-26T12:00:00.000Z",
    "expiresAt": "2029-05-26T12:00:00.000Z"
  }
}
```

**Response 404:**
```json
{ "error": "Not Found", "message": "Lurah belum melakukan enrollment" }
```

### GET `/v1/keys/status`

Endpoint cek ringan yang sudah ada. Response tetap:
```json
{ "success": true, "has_active_key": true, "data": { "...": "..." } }
```

---

## 3. Public Key / Certificate

### GET `/v1/keys/active` (PUBLIC)

Mengambil public key/certificate aktif untuk verifier eksternal.

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
    "createdAt": "2026-05-26T12:00:00.000Z",
    "expiresAt": "2029-05-26T12:00:00.000Z",
    "signer": {
      "nama": "Lurah Talete Satu",
      "nip": "1234567890",
      "jabatan": "Lurah"
    }
  }
}
```

### GET `/v1/keys/public/:verificationCode` (PUBLIC)

Mengambil public key/certificate yang dipakai oleh surat tertentu. Response memuat `certificatePem` dan `rootCaCertificatePem`.

---

## 4. PAdES Signing Workflow

Lurah tetap melihat tugas melalui endpoint submission eksisting, lalu menjalankan signing dua fase.

### GET `/v1/submissions/lurah/list`

Eksisting. Gunakan query/filter yang sudah didukung sistem untuk menampilkan submission `pending_lurah`.

### GET `/v1/submissions/lurah/:id`

Eksisting. Detail submission untuk review sebelum tanda tangan.

### POST `/v1/submissions/:id/lurah/prepare-signing`

Server merender draft PDF, memasukkan placeholder PAdES `/ByteRange`, menghitung hash byte range, membangun DER-encoded PKCS#7 signedAttributes, menyimpan `SigningSession`, lalu mengirim bytes yang harus ditandatangani mobile.

Endpoint ini **tidak** menerbitkan surat. Surat baru final setelah `submit-signature`.

**Auth:** Lurah JWT.

**Body:** kosong.

**Response 200:**
```json
{
  "success": true,
  "data": {
    "sessionId": "456",
    "expiresAt": "2026-05-26T12:05:00.000Z",
    "pdfBase64": "JVBERi0xLjQK...",
    "bytesToSignBase64": "base64 DER signedAttributes SET OF",
    "letterPreview": {
      "letterNumber": "AB12CD34-001/2009/SKD/V/2026",
      "verificationCode": "AB12CD34-001",
      "issuedDate": "2026-05-26T12:00:00.000Z",
      "expiresAt": "2026-08-26T12:00:00.000Z"
    },
    "preview": {
      "letterNumber": "AB12CD34-001/2009/SKD/V/2026",
      "verificationCode": "AB12CD34-001",
      "issuedDate": "2026-05-26T12:00:00.000Z",
      "expiresAt": "2026-08-26T12:00:00.000Z"
    }
  }
}
```

`bytesToSignBase64` adalah DER-encoded PKCS#7 signedAttributes dengan tag SET OF (`0x31`). Mobile harus menandatangani bytes ini persis menggunakan `SHA256withRSA` dari Android Keystore. Jangan pre-hash di mobile.

`preview` adalah alias kompatibilitas untuk `letterPreview`.

**Errors:**

| HTTP | `error` | `message` |
|---|---|---|
| 404 | `Not Found` | `Submission tidak ditemukan` |
| 409 | `Conflict` | `Submission tidak dalam status pending_lurah` |
| 409 | `Conflict` | `Surat sudah pernah diterbitkan` |
| 412 | `Precondition Failed` | `Lurah belum melakukan enrollment sertifikat` |

### POST `/v1/submissions/:id/lurah/submit-signature`

Mobile mengirim signature RSA atas `bytesToSignBase64`. Server memverifikasi signature, membangun PKCS#7 SignedData, menanamkannya ke placeholder PDF, menyimpan final PDF, lalu membuat `IssuedLetter`.

**Auth:** Lurah JWT.

**Body:**
```json
{
  "sessionId": "456",
  "signatureBase64": "base64 encoded RSA signature",
  "note": "catatan approval optional",
  "keterangan": "keterangan surat optional"
}
```

**Response 200:**
```json
{
  "message": "Submission berhasil disetujui dan surat telah diterbitkan",
  "data": {
    "submission": { "...": "..." },
    "letter": {
      "issued_letter_id": "clx...",
      "letter_number": "AB12CD34-001/2009/SKD/V/2026",
      "verification_code": "AB12CD34-001",
      "verification_url": "https://verify.example.com/letters?code=AB12CD34-001",
      "pdf_path": "/public/letters/letter_AB12CD34-001.pdf",
      "signed_at": "2026-05-26T12:02:30.000Z",
      "expires_at": "2026-08-26T12:00:00.000Z"
    }
  }
}
```

**Errors:**

| HTTP | `error` | `message` |
|---|---|---|
| 400 | `Bad Request` | `sessionId dan signatureBase64 wajib diisi` |
| 400 | `Bad Request` | `Signature tidak valid untuk bytesToSign yang diberikan` |
| 403 | `Forbidden` | `Sertifikat penanda tangan sudah revoked atau inactive` |
| 409 | `Conflict` | `Signing session sudah selesai` |
| 409 | `Conflict` | `Surat sudah pernah diterbitkan` |
| 410 | `Gone` | `Signing session sudah lewat 5 menit. Mulai ulang dari prepare-signing.` |

### POST `/v1/submissions/:id/lurah/reject`

Eksisting. Tidak berubah.

### POST `/v1/submissions/:id/lurah/approve` (DEPRECATED)

Endpoint server-side signing lama sudah tidak didukung.

**Response 410:**
```json
{
  "error": "Gone",
  "message": "Endpoint ini sudah tidak didukung. Gunakan /v1/submissions/:id/lurah/prepare-signing dan /submit-signature."
}
```

---

## 5. Verification

Verifier memakai hybrid check:

1. Server check: kode verifikasi ditemukan, surat tidak dicabut, surat belum expired.
2. PAdES check: `/ByteRange` valid, `messageDigest` cocok, signature RSA valid, cert chain valid ke Root CA, fingerprint signer cocok dengan key yang terekam pada `IssuedLetter`.

### POST `/v1/verify` (PUBLIC)

Upload PDF untuk diverifikasi.

**Content-Type:** `multipart/form-data`

**Body:** field `file` berisi PDF.

**Response 200:**
```json
{
  "success": true,
  "data": {
    "valid": true,
    "status": "VALID",
    "message": "Surat valid",
    "serverCheck": { "pass": true, "status": "pass", "reason": "Letter found in records" },
    "cryptoCheck": {
      "pass": true,
      "reason": "PAdES signature valid",
      "keyStatus": "ACTIVE"
    },
    "bodyCheck": { "pass": true, "reason": "PAdES signature valid", "skipped": false },
    "trustCheck": {
      "pass": true,
      "reason": "Cert chain terverifikasi ke Root CA",
      "signerCommonName": "Lurah Talete Satu"
    },
    "letter": {
      "letterNumber": "AB12CD34-001/2009/SKD/V/2026",
      "letterType": "domisili",
      "issuedAt": "2026-05-26T12:00:00.000Z"
    }
  }
}
```

**Status yang dapat muncul:**

| Kondisi | `status` |
|---|---|
| Server check pass dan PAdES pass | `VALID` |
| PDF/body berubah, signature invalid, atau signer mismatch | `TAMPERED` |
| Surat di DB dicabut | `REVOKED` |
| Surat di DB expired | `EXPIRED` |
| Cert signer tidak dipercaya Root CA | `UNTRUSTED_SIGNER` |
| Signature valid tetapi kode tidak terdaftar | `UNREGISTERED_BUT_VALID_SIGNATURE` |
| PDF tidak memiliki signature PAdES atau tidak bisa diparse | `MALFORMED` |
| Tidak terdaftar dan PAdES gagal | `FAKE` |

**Catatan revoked/rotation key:** surat historis tetap `VALID` jika `IssuedLetter.signedAt <= LurahKey.deactivatedAt`. Dalam kondisi ini `cryptoCheck.keyStatus` dapat bernilai `REVOKED` atau `INACTIVE`, dan `cryptoCheck.reason` menjelaskan bahwa surat ditandatangani sebelum key dinonaktifkan.

### GET `/v1/verify/code/:verificationCode` (PUBLIC)

Memverifikasi PDF yang tersimpan di server berdasarkan kode verifikasi. Response sama dengan `POST /v1/verify`, ditambah objek `pdf` berisi metadata dan `dataUrl`.

### GET `/v1/letters/verify/:code` (PUBLIC)

Endpoint legacy publik untuk verifikasi by code. Secara service memakai verifier PAdES yang sama, tetapi controller lama dapat membungkus response untuk kebutuhan backward compatibility.

---

## 6. Lifecycle

### POST `/v1/keys/rotate`

Rotasi device/key Lurah. Flow:

1. Lurah meminta token dengan `POST /v1/keys/enrollment-token` body `{ "purpose": "rotation" }`.
2. Mobile membuat keypair baru di Android Keystore.
3. Mobile mengirim CSR baru ke endpoint ini.
4. Server menandatangani CSR, membuat `LurahKey` baru `ACTIVE`, dan menandai semua key aktif sebelumnya sebagai `REVOKED` dengan `deactivateReason = "ROUTINE_ROTATION"`.

**Auth:** Lurah JWT.

**Body:**
```json
{
  "enrollmentToken": "token purpose rotation",
  "csrPem": "-----BEGIN CERTIFICATE REQUEST-----...",
  "deviceLabel": "HP Baru Lurah"
}
```

**Response 201:**
```json
{
  "success": true,
  "message": "Sertifikat berhasil dirotasi",
  "data": {
    "keyId": "124",
    "certificatePem": "-----BEGIN CERTIFICATE-----...",
    "rootCaCertificatePem": "-----BEGIN CERTIFICATE-----...",
    "serialNumber": "01A2B3C4...",
    "fingerprint": "sha256 hex",
    "algorithm": "RSA-SHA256",
    "issuedAt": "2026-05-26T12:00:00.000Z",
    "expiresAt": "2029-05-26T12:00:00.000Z",
    "revokedKeyId": "123",
    "revokedAt": "2026-05-26T12:00:00.000Z",
    "deactivateReason": "ROUTINE_ROTATION"
  }
}
```

**Errors:**

| HTTP | `error` | `message` |
|---|---|---|
| 400 | `Bad Request` | `enrollmentToken dan csrPem wajib diisi` |
| 400 | `Bad Request` | `Enrollment token tidak cocok dengan operasi yang diminta` |
| 400 | `Bad Request` | CSR invalid atau subject mismatch |
| 410 | `Gone` | Token expired |
| 412 | `Precondition Failed` | `Lurah belum memiliki sertifikat aktif untuk dirotasi` |

### POST `/v1/keys/:id/revoke`

Admin-only. Revoke key secara manual. Tidak mengubah validitas surat historis yang sudah ditandatangani sebelum `deactivatedAt`.

---

## 7. Rate Limiting

Belum wajib di implementasi saat ini. Rekomendasi limit jika dipasang:

| Endpoint | Limit |
|---|---|
| `POST /v1/auth/login` | 5 / menit / IP |
| `POST /v1/keys/enrollment-token` | 5 / hari / Lurah |
| `POST /v1/keys/csr` | 3 / hari / Lurah |
| `POST /v1/keys/rotate` | 3 / hari / Lurah |
| `POST /v1/submissions/*/lurah/prepare-signing` | 30 / menit / Lurah |
| `POST /v1/submissions/*/lurah/submit-signature` | 30 / menit / Lurah |
| `POST /v1/verify` | 60 / menit / IP |
| `GET /v1/verify/code/*` | 60 / menit / IP |

Response 429:
```json
{ "error": "Too Many Requests", "message": "Terlalu banyak request. Coba lagi nanti." }
```

---

## 8. Migration Notes

| Sebelumnya | Setelah v2.0 PAdES |
|---|---|
| Server membuat/menyimpan private key Lurah | Private key hanya berada di Android Keystore |
| `POST /v1/keys/generate` | Deprecated, return `410 Gone` |
| `POST /v1/submissions/:id/lurah/approve` dengan passphrase | Deprecated, return `410 Gone` |
| Custom canonical JSON/body hash untuk signature | Diganti PAdES `/ByteRange` + PKCS#7 SignedData |
| Mobile menandatangani canonical string | Mobile menandatangani `bytesToSignBase64` DER signedAttributes |
| Revoke key membuat surat lama terlihat invalid | Surat lama tetap valid jika signed sebelum key dinonaktifkan |
