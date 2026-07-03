# Sistem Penomoran Surat (Gapless Letter Numbering)

Dokumen ini menjelaskan bagaimana nomor surat dialokasikan agar **berurutan tanpa
loncat** (gapless), sekalipun proses tanda tangan Lurah dibatalkan, kedaluwarsa,
atau diulang. Nomor surat adalah bagian dari **buku register** kelurahan, sehingga
setiap nomor yang "terpakai" wajib benar-benar melekat pada surat yang terbit.

---

## Format Nomor Surat

Contoh: `922E1DF9-017/2009/D.16/VII/2026`

| Bagian        | Contoh      | Sumber                                                        |
| ------------- | ----------- | ------------------------------------------------------------ |
| Prefix acak   | `922E1DF9`  | 8 karakter hex acak (`generateVerificationPrefix`)           |
| Sequence      | `017`       | Nomor urut global gapless (dari `letter_counters` / reservasi) |
| Kode kelurahan| `2009`      | `env.KELURAHAN_CODE`                                          |
| Prefix tipe   | `D.16`      | `letterPrefix` dari schema template per tipe surat           |
| Bulan (romawi)| `VII`       | Bulan penerbitan                                             |
| Tahun         | `2026`      | Tahun penerbitan                                             |

**Kode verifikasi** memakai bagian yang sama: `{prefix_acak}-{sequence}` (mis. `922E1DF9-017`).

Yang menjadi **satuan gapless adalah `sequence`** (angka urut). Sisa string
(prefix tipe, bulan, tahun, prefix acak) dibentuk ulang dari `sequence` saat
dibutuhkan — lihat `LetterService.buildLetterIdentity`.

---

## Masalah yang Diselesaikan

Sebelumnya, nomor surat dialokasikan di dalam `prepareSigning()` dengan menaikkan
counter global `letter_counters` secara atomik, lalu **diikat ke signing session**.
Signing session bersifat sementara (TTL 5 menit, dibersihkan `cleanupExpiredSessions`).

Akibatnya nomor bisa **loncat** pada dua situasi:

1. **Sesi kedaluwarsa** → Lurah membuka lagi dan menekan "Setujui & Tandatangani"
   → `prepareSigning` jalan lagi → counter naik lagi → nomor lama terbuang.
2. **Lurah melihat preview lalu menolak** (`rejectByLurah`) → nomor yang sudah
   dialokasikan tidak pernah terbit.

Keduanya meninggalkan lubang permanen di buku register.

### Kenapa nomor tidak bisa dialokasikan belakangan?

Nomor surat **dicetak ke dalam PDF sebelum** hash `bytesToSign` dihitung
(`signing.service.js`). Perangkat Lurah menandatangani hash dari PDF tersebut.
Jika nomor diubah setelah `prepare`, tanda tangan menjadi tidak valid. Karena itu
**nomor wajib final saat prepare** — solusinya bukan "alokasi belakangan", tetapi
"jangan membuang nomor yang sudah dialokasikan".

---

## Solusi: Reservasi per-Submission + Kolam Daur Ulang

Dua ide digabungkan:

- **Reservasi diikat ke submission, bukan ke session, dan bersifat idempoten.**
  Satu submission memesan satu `sequence` seumur hidupnya. Setiap `prepareSigning`
  berikutnya untuk submission itu **memakai ulang** nomor yang sama.
- **Kolam daur ulang (free-list).** Nomor milik submission yang **ditolak**
  dikembalikan ke kolam. Alokasi berikutnya memakai kembali `sequence` bebas
  terkecil sebelum menaikkan counter → register yang terbit benar-benar gapless.

Konsekuensi yang diterima: nomor hasil daur ulang bisa terbit sedikit tidak urut
secara tanggal. Register diurutkan berdasarkan **nomor**, jadi ini dapat diterima.

---

## Model Data

Tabel baru `letter_reservations` (Prisma model `LetterReservation`):

| Kolom              | Keterangan                                                     |
| ------------------ | -------------------------------------------------------------- |
| `year`, `sequence` | Slot register; `@@unique([year, sequence])`                    |
| `letterNumber`     | String nomor surat lengkap saat reservasi dibentuk             |
| `verificationCode` | Kode verifikasi                                                |
| `status`           | `RESERVED` \| `ISSUED` \| `RELEASED`                           |
| `submissionId`     | Submission pemilik; `@unique`, di-`null`-kan saat dilepas      |

`letter_counters` (counter global lama) tetap dipakai sebagai sumber `sequence`
baru. Counter per-tipe tetap dinaikkan hanya saat alokasi baru, untuk pelaporan.

---

## Siklus Status Reservasi

```
                      prepareSigning (baru / daur ulang)
                                   │
                                   ▼
        ┌────────────────────  RESERVED  ────────────────────┐
        │                                                     │
 submitSignature                                        rejectByLurah
        │                                                     │
        ▼                                                     ▼
     ISSUED  (permanen, keluar dari kolam)              RELEASED  (masuk kolam)
                                                              │
                                                    prepareSigning submission lain
                                                              │  (daur ulang)
                                                              ▼
                                                          RESERVED
```

Catatan penting: **kedaluwarsanya session TIDAK melepas reservasi.** Submission
masih `pending_lurah` dan boleh `prepare` lagi dengan nomor yang sama. Karena itu
logika `cleanupExpiredSessions` tidak berubah — ia hanya menyentuh signing session,
bukan reservasi.

---

## Algoritma Alokasi

`LetterService.reserveLetterIdentity({ type, submissionId })`, seluruhnya dalam satu
`prisma.$transaction`:

```
1. IDEMPOTEN
   Jika submission sudah punya reservasi RESERVED
   → kembalikan letterNumber & verificationCode tersimpan apa adanya.
   (menekan ulang tombol / prepare ulang tidak memakan nomor baru)

2. DAUR ULANG
   SELECT slot RELEASED dengan sequence terkecil untuk tahun ini
     ... FOR UPDATE SKIP LOCKED
   Jika ada → bentuk ulang letterNumber/verificationCode dari sequence tsb
     (memakai prefix tipe & bulan submission yang sekarang),
     set status RESERVED, ikat submissionId.

3. BARU
   Naikkan counter global letter_counters (INSERT ... ON CONFLICT sequence+1),
   bentuk nomor, INSERT baris reservasi RESERVED baru.
```

Transisi lainnya:

- `markReservationIssued({ submissionId }, tx)` — `RESERVED → ISSUED`, dipanggil
  di dalam transaksi penerbitan `submitSignature`.
- `releaseReservation({ submissionId }, tx)` — `RESERVED → RELEASED` + `submissionId = null`,
  dipanggil di dalam transaksi `rejectByLurah`. Aman/no-op bila Lurah tidak pernah `prepare`.

---

## Konkurensi

Dua Lurah yang `prepare` bersamaan tidak boleh mendapat nomor yang sama:

- **`FOR UPDATE SKIP LOCKED`** pada langkah daur ulang memastikan dua transaksi
  mengunci baris RELEASED yang berbeda (atau salah satu jatuh ke langkah "baru").
- Langkah "baru" memakai `INSERT ... ON CONFLICT DO UPDATE sequence + 1` yang atomik.
- `@@unique([submissionId])` mencegah satu submission memiliki dua reservasi aktif.
- `@@unique([year, sequence])` menjamin satu slot register hanya sekali.

---

## Batas Session vs Reservasi

| Peristiwa                          | Signing Session       | Reservasi             |
| ---------------------------------- | --------------------- | --------------------- |
| `prepare` pertama                  | dibuat (PENDING)      | dibuat (RESERVED)     |
| `prepare` ulang, sesi masih hidup  | dipakai ulang¹        | dipakai ulang         |
| Sesi kedaluwarsa                   | → EXPIRED (cleanup)   | **tetap RESERVED**    |
| `submitSignature` sukses           | → COMPLETED           | → ISSUED              |
| `rejectByLurah`                    | (dibiarkan)           | → RELEASED (ke kolam) |

¹ `prepareSigning` melakukan short-circuit: bila ada session PENDING yang belum
kedaluwarsa untuk submission tsb dan draft PDF-nya masih ada, session itu
dikembalikan apa adanya tanpa render ulang.

---

## Pergantian Tahun

`letterNumber` memuat bulan & tahun dari waktu reservasi. Reservasi sebaiknya tidak
dibawa melintasi 1 Januari. Slot `RELEASED` yang tersisa di akhir tahun akan menjadi
lubang tahun tersebut — hal ini dapat diterima karena register memang direset per tahun.

---

## Berkas yang Terlibat

| Berkas                                   | Perubahan                                                     |
| ---------------------------------------- | ------------------------------------------------------------ |
| `prisma/schema.prisma`                   | enum `LetterReservationStatus`, model `LetterReservation`    |
| `src/services/letter.service.js`         | `reserveLetterIdentity`, `buildLetterIdentity`, `markReservationIssued`, `releaseReservation` |
| `src/services/signing.service.js`        | `prepareSigning` (reuse + reservasi), `submitSignature` (tandai ISSUED) |
| `src/services/submission.service.js`     | `rejectByLurah` (lepas reservasi)                            |

---

## Skenario Uji

1. **Prepare ulang / kedaluwarsa** — `prepare` submission `pending_lurah`, catat
   nomor; `prepare` lagi → nomor & kode verifikasi identik; counter global tidak naik.
2. **Alur normal** — `prepare` → `submit-signature` → `issued_letters.letterNumber`
   sama dengan reservasi; baris reservasi `ISSUED`.
3. **Daur ulang** — `prepare` submission A (dapat seq N), `rejectByLurah` A →
   reservasi `RELEASED`; `prepare` submission B → B memakai seq N (bukan N+1);
   terbitkan B → register tanpa lubang di N.
4. **Konkurensi** — dua `prepare` submission berbeda saat ada satu slot bebas →
   keduanya mendapat sequence berbeda (tanpa error duplikat).

Endpoint terkait: `POST /submissions/:id/lurah/prepare-signing` dan
`POST /submissions/:id/lurah/submit-signature`.
