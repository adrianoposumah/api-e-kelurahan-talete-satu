# API E-Kelurahan Talete Satu

REST API untuk **E-Kelurahan Talete Satu** — sistem penerbitan surat digital untuk administrasi kelurahan di Indonesia. Aplikasi ini menangani permohonan surat keterangan oleh warga, alur persetujuan multi-peran (multi-role approval), tanda tangan digital berbasis RSA, serta pembuatan PDF surat yang dapat diverifikasi publik.

---

## Daftar Isi

- [Overview](#overview)
- [Fitur Utama](#fitur-utama)
- [Teknologi](#teknologi)
- [Arsitektur](#arsitektur)
- [Alur Kerja Surat](#alur-kerja-surat)
- [Prasyarat](#prasyarat)
- [Instalasi & Setup](#instalasi--setup)
- [Konfigurasi Environment](#konfigurasi-environment)
- [Menjalankan Aplikasi](#menjalankan-aplikasi)
- [Dokumentasi API](#dokumentasi-api)
- [Perintah Tersedia](#perintah-tersedia)
- [Struktur Direktori](#struktur-direktori)

---

## Overview

E-Kelurahan Talete Satu adalah backend yang mendigitalkan proses pengajuan dan penerbitan surat keterangan kelurahan. Warga mengajukan permohonan beserta dokumen pendukung, lalu permohonan melewati rantai persetujuan dari Kepala Lingkungan (Kepling) hingga Lurah, dan akhirnya diterbitkan oleh Admin dalam bentuk PDF bertanda tangan digital dengan QR code untuk verifikasi keaslian.

Jenis surat didefinisikan secara dinamis melalui template (HTML + schema JSON), sehingga jenis surat baru dapat ditambahkan tanpa banyak perubahan kode. Surat yang diterbitkan ditandatangani secara kriptografis menggunakan kunci RSA-4096 milik Lurah dan dapat diverifikasi publik melalui endpoint khusus tanpa autentikasi.

---

## Fitur Utama

- **Manajemen pengguna & RBAC** — peran: `warga`, `staff`, `kepling`, `lurah`, `sekertaris`, `admin`.
- **Autentikasi JWT** — access token (7 hari) & refresh token (30 hari).
- **Alur persetujuan surat** — state machine berlapis (Kepling → Lurah → terbit).
- **Template surat dinamis** — 8 jenis surat: domisili, usaha, keramaian, belum menikah, keterangan hilang, penghasilan, SKCK, tidak mampu.
- **Tanda tangan digital RSA-4096** — kunci privat Lurah dienkripsi AES-256-GCM.
- **Generasi PDF** — render via Puppeteer, embed QR code & metadata XMP (PAdES-compatible).
- **Verifikasi publik** — pengecekan keaslian surat melalui `/v1/verify/:code`.
- **Data kependudukan** — registry warga berbasis NIK, auto-populate field surat.
- **Notifikasi push** — Firebase Cloud Messaging (FCM).
- **Arsip & dashboard** — pengarsipan surat dan ringkasan statistik.
- **Import data** — dukungan import via Excel (xlsx).
- **Monitoring** — integrasi Sentry untuk error tracking.

---

## Teknologi

| Kategori     | Teknologi                                          |
| ------------ | -------------------------------------------------- |
| Runtime      | Node.js (ES Modules)                               |
| Framework    | Express.js v5                                      |
| Database     | PostgreSQL                                         |
| ORM          | Prisma v7 + `@prisma/adapter-pg`                   |
| Autentikasi  | JWT (`jsonwebtoken`), `bcrypt`                     |
| Tanda tangan | RSA-4096, AES-256-GCM, `@signpdf`, `pdf-lib`       |
| PDF & QR     | Puppeteer, `qrcode`, `jsqr`, `pdf-to-img`, `sharp` |
| Notifikasi   | Firebase Admin SDK (FCM)                           |
| Dokumentasi  | Swagger UI (OpenAPI)                               |
| Monitoring   | Sentry                                             |
| Lint         | ESLint v9                                          |

---

## Arsitektur

Aplikasi mengikuti pola berlapis (layered architecture):

```
routes/       → mendefinisikan endpoint + middleware auth/role
controllers/  → menangani HTTP request/response, memanggil services
services/     → seluruh business logic & akses DB via Prisma
middleware/   → auth (verifikasi JWT + RBAC), upload (Multer)
config/       → env vars, Prisma client, Firebase Admin
templates/    → folder per jenis surat (template HTML + schema JSON)
```

**Entry point:** `src/server.js` memuat file env, memastikan admin ada (produksi), lalu menjalankan HTTP server. `src/app.js` menyusun middleware, CORS, static files, dan mendaftarkan seluruh route di bawah prefix `/v1`.

---

## Alur Kerja Surat

Permohonan melewati state machine berikut:

```
pending_kepling → pending_lurah → approved → issued
```

1. **Warga** membuat permohonan beserta dokumen wajib (upload via Multer).
2. **Kepling** (Kepala Lingkungan) menyetujui / menolak.
3. **Lurah** menyetujui (atau menolak kembali ke Kepling).
4. **Admin** menerbitkan surat: nomor surat dibuat, PDF bertanda tangan RSA dengan QR code dihasilkan, dan kode verifikasi disimpan di tabel `issued_letters`.

### Tanda Tangan Digital

- Lurah membuat pasangan kunci RSA-4096; kunci privat dienkripsi AES-256-GCM (derivasi scrypt) dan disimpan di tabel `lurah_keys`.
- Saat penerbitan: data surat dikanonikalisasi, di-hash SHA-256, lalu ditandatangani dengan kunci privat Lurah.
- PDF dirender via Puppeteer, QR code di-embed, metadata XMP (tanda tangan + kode verifikasi) ditambahkan via pdf-lib.
- Verifikasi publik di `/v1/verify/:code` memeriksa tanda tangan tanpa perlu autentikasi.

---

## Prasyarat

Pastikan sudah terpasang:

- **Node.js** v18+ (disarankan v20 LTS)
- **PostgreSQL** v14+
- **npm** (terpasang bersama Node.js)
- **Chromium/Chrome** — diunduh otomatis oleh Puppeteer saat `npm install`

---

## Instalasi & Setup

### 1. Clone repository

```bash
git clone <repository-url>
cd api-e-kelurahan-talete-satu
```

### 2. Install dependencies

```bash
npm install
```

> Puppeteer akan mengunduh Chromium secara otomatis pada tahap ini.

### 3. Siapkan database PostgreSQL

Buat database kosong, misalnya `ekelurahan`:

```sql
CREATE DATABASE ekelurahan;
```

### 4. Konfigurasi environment

Buat file `.env.development` (untuk dev) dan/atau `.env.production` (untuk produksi). Lihat bagian [Konfigurasi Environment](#konfigurasi-environment).

### 5. Jalankan migrasi & generate Prisma Client

```bash
npx prisma migrate dev      # menjalankan migrasi & membuat tabel
npx prisma generate         # generate Prisma Client
```

### 6. Seed admin (opsional, untuk produksi)

```bash
npx prisma db seed
```

Di mode produksi, admin juga dibuat otomatis saat startup berdasarkan variabel `ADMIN_NOHP` & `ADMIN_PASSWORD`.

### 7. Bootstrap Root CA (untuk tanda tangan digital)

```bash
node scripts/bootstrap-root-ca.js
```

> Backup file `secure-storage/root-ca-key.pem` ke storage offline dan **jangan** commit folder `secure-storage/`.

---

## Konfigurasi Environment

Server memuat file env berdasarkan `NODE_ENV`: `.env.production` untuk produksi, `.env.development` untuk lainnya (`dotenv` juga membaca `.env` sebagai fallback).

Contoh `.env.development`:

```env
PORT=5000
BASE_URL=http://localhost:5000
LOG_LEVEL=debug
TZ=Asia/Makassar

# Database
DATABASE_URL="postgresql://postgres:admin@localhost:5432/ekelurahan?schema=public"

# JWT
JWT_SECRET=dev-secret-key-change-in-production
JWT_EXPIRES_IN=7d
JWT_REFRESH_SECRET=dev-refresh-secret-key-change-in-production
JWT_REFRESH_EXPIRES_IN=30d

# Root CA (tanda tangan digital)
ROOT_CA_KEY_PASSPHRASE=isi_passphrase_yang_kuat
```

### Daftar Variabel Environment

| Variabel                 | Wajib | Keterangan                                                          |
| ------------------------ | :---: | ------------------------------------------------------------------- |
| `PORT`                   |   ✓   | Port server (default `3000`)                                        |
| `BASE_URL`               |   ✓   | URL dasar untuk membangun URL PDF/aset & link QR verifikasi         |
| `TZ`                     |   ✓   | Zona waktu (`Asia/Makassar`)                                        |
| `DATABASE_URL`           |   ✓   | Connection string PostgreSQL                                        |
| `JWT_SECRET`             |   ✓   | Secret untuk access token                                           |
| `JWT_EXPIRES_IN`         |   ✓   | Masa berlaku access token (mis. `7d`)                               |
| `JWT_REFRESH_SECRET`     |   ✓   | Secret untuk refresh token                                          |
| `JWT_REFRESH_EXPIRES_IN` |   ✓   | Masa berlaku refresh token (mis. `30d`)                             |
| `VERIFICATION_URL`       |       | URL frontend verifikasi publik (di-embed di QR code)                |
| `ADMIN_DASHBOARD_URL`    |       | Origin dashboard admin (untuk allowlist CORS)                       |
| `ROOT_CA_KEY_PASSPHRASE` |   ✓   | Passphrase untuk kunci Root CA                                      |
| `ROOT_CA_CERT_PATH`      |       | Path sertifikat Root CA (default `secure-storage/root-ca-cert.pem`) |
| `ROOT_CA_KEY_PATH`       |       | Path kunci Root CA (default `secure-storage/root-ca-key.pem`)       |
| `KELURAHAN_CODE`         |       | Kode kelurahan (default `2009`)                                     |
| `PDF_STORAGE_DIR`        |       | Direktori penyimpanan PDF (default `public/letters`)                |
| `PDF_DRAFT_DIR`          |       | Direktori draft PDF (default `storage/letter-drafts`)               |
| `SENTRY_DSN`             |       | DSN Sentry untuk error tracking                                     |
| `ADMIN_NOHP`             |       | No. HP admin (seeding produksi)                                     |
| `ADMIN_PASSWORD`         |       | Password admin (seeding produksi)                                   |
| `ADMIN_NAME`             |       | Nama admin (opsional, default `Administrator`)                      |

> **Firebase Admin SDK** membaca dari `serviceAccountKey.json` (gitignored) atau variabel env setara untuk notifikasi FCM.

`VERIFICATION_URL` dan `ADMIN_DASHBOARD_URL` dapat berisi beberapa origin yang dipisahkan koma; nilainya digunakan untuk allowlist CORS.

---

## Menjalankan Aplikasi

### Mode development (dengan auto-reload)

```bash
npm run dev
```

### Mode produksi

```bash
npm start
```

Setelah berjalan, cek health endpoint:

```bash
curl http://localhost:5000/health
```

---

## Dokumentasi API

- **Swagger UI:** `http://localhost:<PORT>/docs`
- **Spec OpenAPI:** `swagger.yaml`

Seluruh endpoint API berada di bawah prefix `/v1`. Grup endpoint utama:

| Prefix                   | Fungsi                               |
| ------------------------ | ------------------------------------ |
| `/v1/auth`               | Autentikasi (login, register, token) |
| `/v1/users`              | Manajemen pengguna                   |
| `/v1/validate-requests`  | Validasi permohonan akun             |
| `/v1/admin`              | Operasi admin                        |
| `/v1/lingkungan`         | Data lingkungan/neighborhood         |
| `/v1/data-kependudukan`  | Registry kependudukan (NIK)          |
| `/v1/submissions`        | Pengajuan surat                      |
| `/v1/letters`            | Penerbitan & pengelolaan surat       |
| `/v1/keys`               | Manajemen kunci Lurah                |
| `/v1/verify` (`/verify`) | Verifikasi publik surat              |
| `/v1/notifications`      | Notifikasi (FCM)                     |
| `/v1/arsip`              | Arsip surat                          |
| `/v1/dashboard`          | Statistik dashboard                  |

---

## Perintah Tersedia

```bash
npm run dev                       # Development dengan nodemon (NODE_ENV=development)
npm start                         # Server produksi (NODE_ENV=production)
npm run lint                      # Pengecekan ESLint
npm run lint:fix                  # ESLint auto-fix

npx prisma migrate dev            # Menjalankan migrasi DB
npx prisma db seed                # Seed admin user
npx prisma studio                 # Browse database via Prisma Studio
npx prisma generate               # Generate Prisma Client

node scripts/bootstrap-root-ca.js # Bootstrap Root CA untuk tanda tangan

npm run test:pades:pkcs7          # Test PAdES PKCS#7
npm run test:pades:pdf            # Test PAdES PDF placeholder
npm run verify:fixtures           # Buat fixture verifikasi
npm run verify:scenarios          # Jalankan skenario verifikasi
```

> Tidak ada suite test otomatis terkonfigurasi — validasi dilakukan manual via Swagger UI di `/docs`.

---

## Struktur Direktori

```
api-e-kelurahan-talete-satu/
├── prisma/
│   ├── schema.prisma        # Skema database
│   └── seed.js              # Seeder admin
├── public/
│   ├── assets/              # Aset statis (logo, dsb.)
│   └── letters/             # PDF surat yang diterbitkan
├── scripts/                 # Skrip utilitas (bootstrap CA, cleanup, dsb.)
├── secure-storage/          # Root CA cert & key (gitignored)
├── src/
│   ├── config/              # Env, Prisma, Firebase
│   ├── controllers/         # Handler HTTP
│   ├── lib/                 # Utilitas (schemaLoader, dsb.)
│   ├── middleware/          # Auth (JWT + RBAC), upload (Multer)
│   ├── routes/              # Definisi endpoint
│   ├── services/            # Business logic (crypto, pdf, signing, dsb.)
│   ├── templates/           # Template per jenis surat (HTML + schema.json)
│   ├── validators/          # Validasi submission
│   ├── app.js               # Setup Express
│   └── server.js            # Entry point
├── uploads/                 # File upload warga
├── swagger.yaml             # Spesifikasi OpenAPI
├── CLAUDE.md                # Panduan untuk Claude Code
└── package.json
```

---

## Menambah Jenis Surat Baru

1. Buat folder baru di `src/templates/<nama_surat>/`.
2. Tambahkan `schema.json` (field wajib, file upload, MIME constraint) dan `template.html`.
3. Tambahkan entri pada enum `SubmissionType` di `prisma/schema.prisma`.
4. Jalankan migrasi: `npx prisma migrate dev --name add_<nama_surat>`.
