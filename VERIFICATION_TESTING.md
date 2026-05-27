# Panduan Testing & Demo — Verifikasi Surat (Hybrid Verification)

Dokumen ini berisi skenario uji dan langkah demo untuk sistem verifikasi surat **E-Kelurahan Talete Satu**. Tujuannya: membuktikan bahwa verifikasi hybrid (server lookup + kriptografi PAdES) memberi keputusan yang benar untuk surat asli maupun berbagai bentuk pemalsuan.

> Audien: penguji, evaluator skripsi, demonstrator sidang.
> File terkait: [src/services/verification.service.js](src/services/verification.service.js), [src/services/pdf.service.js](src/services/pdf.service.js), [LETTER_ISSUANCE_DESIGN.md](LETTER_ISSUANCE_DESIGN.md), [LURAH_KEY_DESIGN.md](LURAH_KEY_DESIGN.md).

---

## 1. Konsep yang Diuji

Verifikasi surat menggunakan **dua jalur independen** yang digabung jadi satu keputusan:

| Jalur | Pertanyaan | Sumber |
|---|---|---|
| **Server check** | "Apakah kode verifikasi ini terdaftar dan masih berlaku?" | QR code di PDF → query `issued_letters` |
| **PAdES check** | "Apakah dokumen ini otentik dan tidak dimodifikasi?" | Parse PKCS#7 → verify signature + cert chain |

Kekuatan hybrid: **server check tetap jalan walaupun signature rusak/hilang** (karena kode diambil dari QR, bukan dari signature). Ini memungkinkan deteksi kelas serangan "QR transplant" yang tidak bisa dideteksi sistem yang hanya mengandalkan kriptografi.

---

## 2. Matriks Keputusan (Decision Matrix)

Diturunkan dari `decideResult()` di [verification.service.js](src/services/verification.service.js#L169-L182).

| Server check | PAdES check | Status final | valid | Arti |
|---|---|---|---|---|
| `pass` | `pass` | `VALID` | ✅ | Surat asli, terdaftar, tidak dimodifikasi |
| `revoked` | `pass` | `REVOKED` | ❌ | Surat asli tapi sudah dicabut admin |
| `expired` | `pass` | `EXPIRED` | ❌ | Surat asli tapi masa berlaku habis |
| `not_found` | `pass` | `UNREGISTERED_BUT_VALID_SIGNATURE` | ❌ | Signature valid tapi kode tidak ada di DB |
| `pass` | `untrusted` | `UNTRUSTED_SIGNER` | ❌ | Cert penanda tangan tidak rantai ke Root CA |
| `pass` | `revoked_key` | `REVOKED_SIGNER` | ❌ | Key Lurah sudah dicabut saat surat ditandatangani |
| `pass` | `expired_key` | `EXPIRED_SIGNER` | ❌ | Sertifikat Lurah expired saat penandatanganan |
| `pass` | `missing_pades` | `TAMPERED_QR_TRANSPLANT` | ❌ | Kode terdaftar tapi dokumen tanpa signature → QR disalin dari surat lain |
| `pass` | `content_modified` / `signature_invalid` / `signer_mismatch` | `TAMPERED` | ❌ | Isi PDF dimodifikasi setelah ditandatangani |
| `pass` | `parse_error` | `MALFORMED` | ❌ | Signature PAdES rusak/tidak bisa diparse |
| `not_found` | apapun yang gagal | `FAKE` | ❌ | Surat palsu / tidak dikenali |

---

## 3. Prasyarat Demo

1. Server berjalan: `npm run dev` (atau `npm start`)
2. Root CA sudah di-bootstrap (`ROOT_CA_KEY_PASSPHRASE` di-set, jalankan `scripts/bootstrap-root-ca.js`)
3. Minimal **satu surat asli** sudah diterbitkan via flow lengkap (warga → kepling → lurah sign). Catat `verificationCode`-nya (misal `B860DB60-003`).
4. PDF surat asli ada di `public/letters/letter_<CODE>.pdf`
5. Tools opsional untuk demo: browser untuk hit `VERIFICATION_URL`, atau Postman/curl untuk API.

> **Penting**: surat asli harus dibuat dengan pipeline signing terbaru (pdf-lib backend) agar PAdES check `pass`. Surat lama (pre-keystore-revision) mungkin tidak lolos crypto check.

---

## 4. Endpoint Verifikasi

| Method | Endpoint | Input | Kegunaan |
|---|---|---|---|
| `POST` | `/v1/verify` | multipart `file` (PDF) | Verifikasi PDF yang di-upload (hybrid penuh) |
| `POST` | `/v1/verify/code` | JSON `{ "verificationCode": "..." }` | Verifikasi PDF tersimpan di server by kode |
| `GET` | `/v1/verify/code/:code` | path param | Sama, via GET (cocok untuk QR link) |
| `GET` | `/v1/letters/verify/:code` | path param | Verifikasi via letter controller |

Semua endpoint **publik** (tanpa auth) — sesuai use case verifikasi oleh siapa saja.

Contoh response (disederhanakan):

```json
{
  "valid": true,
  "status": "VALID",
  "message": "Surat valid",
  "serverCheck": { "pass": true, "status": "pass", "reason": "Letter found in records", "codeSource": "qr" },
  "cryptoCheck": { "pass": true, "reason": "PAdES signature valid", "keyStatus": "ACTIVE" },
  "trustCheck": { "pass": true, "reason": "Cert chain terverifikasi ke Root CA", "signerCommonName": "Lurah Talete Satu" },
  "letter": { "letterNumber": "...", "letterType": "domisili", "issuedAt": "...", "formData": {} }
}
```

---

## 5. Skenario Uji & Cara Reproduksi

Untuk setiap skenario di bawah, asumsikan `CODE` = verification code surat asli, dan `letter_<CODE>.pdf` ada di `public/letters/`.

### Skenario 1 — Surat Asli (VALID)

**Tujuan**: baseline, surat yang sah harus lolos.

```bash
# Via kode (server membaca PDF tersimpan)
curl -X GET "http://localhost:3001/v1/verify/code/<CODE>"

# Atau upload file asli
curl -X POST "http://localhost:3001/v1/verify" \
  -F "file=@public/letters/letter_<CODE>.pdf"
```

**Expected**: `status: VALID`, `valid: true`, server + crypto + trust semua `pass`.

---

### Skenario 2 — Isi Surat Dimodifikasi (TAMPERED)

**Tujuan**: pelaku mengubah teks/data surat asli (misal ganti nama), QR & signature dibiarkan.

Cara membuat fixture: flip beberapa byte di area konten PDF (di luar `/Contents` signature). QR tetap utuh sehingga server check pass, tapi ByteRange hash tidak cocok.

```bash
node scripts/make-verification-fixtures.js <CODE>
# menghasilkan tmp-verify/tampered.pdf
curl -X POST "http://localhost:3001/v1/verify" -F "file=@tmp-verify/tampered.pdf"
```

**Expected**: `status: TAMPERED`, `serverCheck.pass: true`, `cryptoCheck.pass: false` (reason: "ByteRange hash tidak cocok dengan messageDigest").

**Poin demo**: server tahu kode ini terdaftar, tapi crypto mendeteksi modifikasi → sistem bisa bilang "ini surat asli yang sudah diubah", bukan sekadar "tidak valid".

---

### Skenario 3 — QR Transplant (TAMPERED_QR_TRANSPLANT)

**Tujuan**: pelaku membuat PDF palsu dari nol, lalu menempelkan QR dari surat asli (atau menyalin kode). PDF palsu **tidak punya signature PAdES**.

Cara membuat fixture: ambil PDF asli, hapus signature dictionary (strip marker `/ByteRange`), QR tetap ada.

```bash
# fixture: tmp-verify/qr-transplant.pdf
curl -X POST "http://localhost:3001/v1/verify" -F "file=@tmp-verify/qr-transplant.pdf"
```

**Expected**: `status: TAMPERED_QR_TRANSPLANT`, `serverCheck.pass: true`, `cryptoCheck.pass: false` (reason: "PDF tidak memiliki signature PAdES").

**Poin demo (paling penting untuk sidang)**: inilah nilai tambah hybrid. Sistem yang hanya cek kriptografi akan bilang "tidak ada signature" tanpa konteks. Sistem hybrid bilang: *"kode ini terdaftar atas nama X, TAPI dokumen yang Anda pegang bukan dokumen asli — minta dokumen resmi ke penerbit."*

---

### Skenario 4 — Surat Dicabut (REVOKED)

**Tujuan**: surat asli yang sudah dicabut admin.

```bash
# 1. Revoke surat (butuh auth admin)
curl -X POST "http://localhost:3001/v1/letters/<CODE>/revoke" \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"reason":"Demo pencabutan"}'

# 2. Verifikasi
curl -X GET "http://localhost:3001/v1/verify/code/<CODE>"
```

**Expected**: `status: REVOKED`, `serverCheck.status: revoked`, `cryptoCheck.pass: true` (signature masih valid, tapi server menandai dicabut).

---

### Skenario 5 — Surat Kadaluarsa (EXPIRED)

**Tujuan**: surat asli yang `expiresAt` sudah lewat.

Cara membuat: set `expiresAt` ke masa lampau via Prisma Studio atau SQL, lalu verifikasi.

```sql
UPDATE issued_letters SET expires_at = '2020-01-01T00:00:00Z' WHERE verification_code = '<CODE>';
```

```bash
curl -X GET "http://localhost:3001/v1/verify/code/<CODE>"
```

**Expected**: `status: EXPIRED`, `serverCheck.status: expired`, `cryptoCheck.pass: true`.

---

### Skenario 6 — Surat Palsu Total (FAKE)

**Tujuan**: PDF random tanpa QR yang dikenal, tidak terdaftar di DB.

```bash
# fixture: tmp-verify/fake.pdf (PDF biasa tanpa QR/kode sistem)
curl -X POST "http://localhost:3001/v1/verify" -F "file=@tmp-verify/fake.pdf"
```

**Expected**: `status: FAKE`, `serverCheck.pass: false` (status `not_found`), `cryptoCheck.pass: false`.

---

### Skenario 7 — Signer Tidak Dipercaya (UNTRUSTED_SIGNER)

**Tujuan**: PDF ditandatangani oleh cert yang TIDAK diterbitkan Root CA kelurahan (misal self-signed cert pihak lain), tapi kode kebetulan ada di DB.

Cara membuat: butuh PDF yang disign dengan cert asing. Lebih cocok untuk unit test daripada demo live. Lihat `scripts/make-verification-fixtures.js` (opsi `--untrusted`, jika diimplementasikan) atau buat manual dengan key/cert eksternal.

**Expected**: `status: UNTRUSTED_SIGNER`, `serverCheck.pass: true`, `cryptoCheck` gagal di tahap cert chain.

---

### Skenario 8 — Key Lurah Dicabut/Expired (REVOKED_SIGNER / EXPIRED_SIGNER)

**Tujuan**: surat ditandatangani dengan key yang statusnya bukan ACTIVE, dan surat ditandatangani SETELAH key dinonaktifkan (kasus mencurigakan).

Catatan penting: surat yang ditandatangani **sebelum** key dicabut tetap `VALID` (guard `signedAt ≤ deactivatedAt` di [verification.service.js](src/services/verification.service.js#L141-L150)). Jadi skenario ini hanya tercapai bila ada inkonsistensi waktu — lebih cocok diuji di unit test dengan data buatan.

**Expected**: `status: REVOKED_SIGNER` (atau `EXPIRED_SIGNER`), `serverCheck.pass: true`, `cryptoCheck.reason` menyebut status key.

---

## 6. Script Pembuat Fixture

File `scripts/make-verification-fixtures.js` **sudah tersedia di repo**. Isinya men-generate fixture skenario 2, 3, dan 6 secara otomatis dari surat asli:

```javascript
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const code = process.argv[2];
if (!code) {
  console.error('Usage: node scripts/make-verification-fixtures.js <CODE>');
  process.exit(1);
}

const srcPath = join('public', 'letters', `letter_${code}.pdf`);
const outDir = 'tmp-verify';
mkdirSync(outDir, { recursive: true });

const original = readFileSync(srcPath);

// --- Skenario 2: TAMPERED (modifikasi konten, QR + signature struktur tetap) ---
// Flip byte di area konten (jauh dari /Contents signature, dekat awal stream konten)
const tampered = Buffer.from(original);
const text = tampered.toString('latin1');
// cari posisi sebuah angka di body untuk diubah (hindari area /Contents)
const contentsIdx = text.indexOf('/Contents <');
const flipAt = Math.min(5000, contentsIdx - 500);
for (let i = flipAt; i < flipAt + 40; i++) {
  if (tampered[i] >= 0x41 && tampered[i] <= 0x5a) tampered[i] = tampered[i] === 0x41 ? 0x42 : 0x41;
}
writeFileSync(join(outDir, 'tampered.pdf'), tampered);

// --- Skenario 3: QR_TRANSPLANT (hapus signature PAdES, QR tetap) ---
// Rusak marker /ByteRange agar hasPadesSignature() = false, tapi QR image tetap utuh
const transplant = Buffer.from(original);
const brIdx = transplant.toString('latin1').indexOf('/ByteRange');
if (brIdx !== -1) transplant.write('/XXXXRange', brIdx, 'latin1');
writeFileSync(join(outDir, 'qr-transplant.pdf'), transplant);

// --- Skenario 6: FAKE (PDF minimal tanpa QR/kode sistem) ---
const fake = Buffer.from(
  '%PDF-1.7\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
  '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]>>endobj\n' +
  'trailer<</Root 1 0 R>>\n%%EOF',
  'latin1',
);
writeFileSync(join(outDir, 'fake.pdf'), fake);

console.log('Fixtures dibuat di', outDir + '/:');
console.log('  - tampered.pdf       → expect TAMPERED');
console.log('  - qr-transplant.pdf  → expect TAMPERED_QR_TRANSPLANT');
console.log('  - fake.pdf           → expect FAKE');
```

Jalankan:

```bash
node scripts/make-verification-fixtures.js B860DB60-003
```

---

## 7. Skrip Uji Otomatis (End-to-End)

File `scripts/run-verification-scenarios.js` **sudah tersedia di repo**. Ia menjalankan seluruh matriks sekaligus tanpa perlu server (memanggil `verificationService` langsung):

```javascript
import 'dotenv/config';
import { config } from 'dotenv';
config({ path: '.env.development' });

import { readFileSync } from 'fs';
import { join } from 'path';

const code = process.argv[2];
const verificationService = (await import('../src/services/verification.service.js')).default;

const cases = [
  { name: 'VALID (asli)', file: join('public', 'letters', `letter_${code}.pdf`), expect: 'VALID' },
  { name: 'TAMPERED', file: 'tmp-verify/tampered.pdf', expect: 'TAMPERED' },
  { name: 'QR_TRANSPLANT', file: 'tmp-verify/qr-transplant.pdf', expect: 'TAMPERED_QR_TRANSPLANT' },
  { name: 'FAKE', file: 'tmp-verify/fake.pdf', expect: 'FAKE' },
];

let passed = 0;
for (const c of cases) {
  try {
    const buf = readFileSync(c.file);
    const r = await verificationService.verifyLetter(buf);
    const ok = r.status === c.expect;
    if (ok) passed += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name.padEnd(18)} → ${r.status} (expect ${c.expect})`);
    if (!ok) console.log(`        server=${r.serverCheck.status} crypto=${r.cryptoCheck.pass} reason="${r.cryptoCheck.reason}"`);
  } catch (e) {
    console.log(`ERROR ${c.name.padEnd(18)} → ${e.message}`);
  }
}
console.log(`\n${passed}/${cases.length} skenario sesuai ekspektasi.`);
process.exit(passed === cases.length ? 0 : 1);
```

Jalankan (kedua skrip ini **sudah tersedia** di repo, plus npm shortcut):

```bash
# bentuk panjang
node scripts/make-verification-fixtures.js B860DB60-003
node scripts/run-verification-scenarios.js B860DB60-003

# atau via npm script
npm run verify:fixtures -- B860DB60-003
npm run verify:scenarios -- B860DB60-003
```

Output yang diharapkan:

```
PASS  VALID (asli)       → VALID (expect VALID)
PASS  TAMPERED           → TAMPERED (expect TAMPERED)
PASS  QR_TRANSPLANT      → TAMPERED_QR_TRANSPLANT (expect TAMPERED_QR_TRANSPLANT)
PASS  FAKE               → FAKE (expect FAKE)

4/4 skenario sesuai ekspektasi.
```

> Catatan: skrip ini perlu env yang benar (`.env.development` dengan `ROOT_CA_KEY_PASSPHRASE` di-set) agar crypto check `VALID` lolos. Tanpa Root CA, skenario VALID akan jadi `MALFORMED`.

---

## 8. Alur Demo untuk Sidang (Narasi)

Urutan yang disarankan untuk presentasi (8-10 menit):

1. **Tunjukkan surat asli** — buka `letter_<CODE>.pdf`, scan QR-nya dengan HP. Buka link verifikasi → tampil **VALID** dengan nama pemohon & nomor surat. *"Sistem mengonfirmasi surat ini asli dan tidak dimodifikasi."*

2. **Modifikasi surat** — edit teks di PDF (atau pakai `tampered.pdf`), verifikasi ulang → **TAMPERED**. *"Begitu satu karakter pun diubah, tanda tangan digital langsung mendeteksinya."*

3. **QR transplant (highlight)** — tunjukkan `qr-transplant.pdf` (PDF palsu dengan QR asli ditempel), verifikasi → **TAMPERED_QR_TRANSPLANT**. *"Inilah kelebihan verifikasi hybrid: walaupun penjahat menyalin QR yang valid, sistem tetap tahu dokumennya bukan yang asli — dan bisa memberi tahu verifikator bahwa kode ini terdaftar atas nama siapa, sehingga mereka bisa minta dokumen resmi."*

4. **Surat palsu total** — `fake.pdf`, verifikasi → **FAKE**. *"PDF yang tidak pernah diterbitkan sistem langsung ditolak."*

5. **(Opsional) Pencabutan** — revoke surat lewat dashboard admin, verifikasi ulang → **REVOKED**. *"Admin bisa mencabut surat kapan saja, dan verifikasi langsung mencerminkannya."*

6. **Penutup** — tunjukkan matriks keputusan (section 2) sebagai ringkasan menyeluruh.

---

## 9. Checklist Sebelum Demo

- [ ] Server berjalan dan dapat diakses
- [ ] Root CA ter-bootstrap (`ROOT_CA_KEY_PASSPHRASE` ter-set)
- [ ] Minimal 1 surat asli ter-issue dengan pipeline terbaru
- [ ] `node scripts/make-verification-fixtures.js <CODE>` sudah dijalankan
- [ ] `node scripts/run-verification-scenarios.js <CODE>` menunjukkan 4/4 PASS
- [ ] Frontend `VERIFICATION_URL` dapat diakses (untuk demo scan QR)
- [ ] HP/scanner QR siap (untuk demo live)
- [ ] Folder `tmp-verify/` sudah berisi fixture

---

## 10. Troubleshooting

| Gejala | Kemungkinan penyebab | Solusi |
|---|---|---|
| Skenario VALID jadi `MALFORMED` | Root CA tidak ter-load (`ROOT_CA_KEY_PASSPHRASE` kosong) | Set env & pastikan `secure-storage/` ada |
| Skenario VALID jadi `TAMPERED` | Surat dibuat dengan pipeline lama, atau PDF dimodifikasi tak sengaja | Re-issue surat dengan pipeline terbaru |
| Semua jadi `FAKE` | QR tidak ter-decode (PDF rusak/scale rendah) | Cek `extractQRCodeFromPdf`; pastikan QR ada di PDF |
| `qr-transplant.pdf` jadi `FAKE` bukan `TAMPERED_QR_TRANSPLANT` | QR ikut rusak saat strip signature | Pastikan hanya marker `/ByteRange` yang diubah, QR image utuh |
| Server check selalu `not_found` | Kode di QR tidak match DB | Cek `verificationCode` di tabel `issued_letters` |

---

*Last updated: 2026-05-27. Disusun untuk pipeline verifikasi pada branch `keystore-revision`.*
