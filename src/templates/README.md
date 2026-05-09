# Daftar Tipe Surat dan Schema

Dokumen ini merangkum semua tipe surat yang tersedia di `src/templates`.
Setiap tipe surat memiliki `schema.json` dan `template.html`.

## Ringkasan Tipe Surat

| Type | Nama Surat | Letter Prefix | Masa Berlaku |
| --- | --- | --- | --- |
| `belum_menikah` | Surat Keterangan Belum Menikah | `H.3` | 30 hari |
| `domisili` | Surat Keterangan Domisili | `D.16` | 30 hari |
| `keramaian` | Surat Izin Keramaian | `H.1` | 7 hari |
| `keterangan_hilang` | Surat Keterangan Hilang | `H.6` | 30 hari |
| `penghasilan` | Surat Keterangan Penghasilan | `H.6` | 30 hari |
| `skck` | Surat Permohonan SKCK | `H.1` | 30 hari |
| `tidak_mampu` | Surat Keterangan Kurang Mampu | `H.6` | 30 hari |
| `usaha` | Surat Keterangan Usaha | `H.6` | 30 hari |

## `belum_menikah`

**Label:** Surat Keterangan Belum Menikah

**Deskripsi:** Surat keterangan belum menikah untuk keperluan administrasi

**Letter prefix:** `H.3`

**Masa berlaku:** 30 hari

**Fields wajib:**

| Field | Required |
| --- | --- |
| `nama_lengkap` | Ya |
| `jenis_kelamin` | Ya |
| `tempat_lahir` | Ya |
| `tanggal_lahir` | Ya |
| `agama` | Ya |
| `pekerjaan` | Ya |
| `status_perkawinan` | Ya |
| `kewarganegaraan` | Ya |
| `alamat` | Ya |
| `tujuan` | Ya |
| `nama_ayah` | Ya |
| `umur_ayah` | Ya |
| `pekerjaan_ayah` | Ya |
| `alamat_ayah` | Ya |
| `nama_ibu` | Ya |
| `umur_ibu` | Ya |
| `pekerjaan_ibu` | Ya |
| `alamat_ibu` | Ya |

**File upload:**

| Field | Required | Max Count |
| --- | --- | --- |
| `ktp` | Ya | 1 |
| `kartu_keluarga` | Ya | 1 |
| `surat_lainnya` | Tidak | 1 |

**Auto populated fields:** `nama_lengkap`, `jenis_kelamin`, `tempat_lahir`, `tanggal_lahir`, `agama`, `pekerjaan`, `kewarganegaraan`, `alamat`, `lingkungan`

## `domisili`

**Label:** Surat Keterangan Domisili

**Deskripsi:** Surat keterangan domisili untuk warga

**Letter prefix:** `D.16`

**Masa berlaku:** 30 hari

**Fields wajib:**

| Field | Required |
| --- | --- |
| `nama_lengkap` | Ya |
| `jenis_kelamin` | Ya |
| `tempat_lahir` | Ya |
| `tanggal_lahir` | Ya |
| `nik` | Ya |
| `pekerjaan` | Ya |
| `agama` | Ya |
| `kewarganegaraan` | Ya |
| `tujuan` | Ya |

**Auto populated fields:** `nama_lengkap`, `nik`, `jenis_kelamin`, `tempat_lahir`, `tanggal_lahir`, `pekerjaan`, `agama`, `kewarganegaraan`, `alamat`, `lingkungan`

**File upload:**

| Field | Required | Max Count |
| --- | --- | --- |
| `ktp` | Ya | 1 |
| `kartu_keluarga` | Ya | 1 |
| `surat_lainnya` | Tidak | 1 |

## `keramaian`

**Label:** Surat Izin Keramaian

**Deskripsi:** Surat izin penyelenggaraan keramaian/acara

**Letter prefix:** `H.1`

**Masa berlaku:** 7 hari

**Fields wajib:**

| Field | Required |
| --- | --- |
| `nama` | Ya |
| `alamat` | Ya |
| `nama_acara` | Ya |
| `jenis_acara` | Ya |
| `tanggal_acara` | Ya |
| `waktu` | Ya |
| `tempat_acara` | Ya |

**Auto populated fields:** `nama_lengkap`, `nik`, `alamat`, `lingkungan`

**File upload:**

| Field | Required | Max Count |
| --- | --- | --- |
| `ktp` | Ya | 1 |
| `surat_lainnya` | Tidak | 1 |

## `keterangan_hilang`

**Label:** Surat Keterangan Hilang

**Deskripsi:** Surat keterangan hilang untuk keperluan administrasi

**Letter prefix:** `H.6`

**Masa berlaku:** 30 hari

**Fields wajib:**

| Field | Required |
| --- | --- |
| `nama_lengkap` | Ya |
| `jenis_kelamin` | Ya |
| `tempat_lahir` | Ya |
| `tanggal_lahir` | Ya |
| `agama` | Ya |
| `pekerjaan` | Ya |
| `alamat` | Ya |
| `barang_hilang` | Ya |
| `tujuan` | Ya |

**File upload:**

| Field | Required | Max Count |
| --- | --- | --- |
| `kartu_keluarga` | Ya | 1 |
| `surat_lainnya` | Tidak | 1 |

**Auto populated fields:** `nama_lengkap`, `jenis_kelamin`, `tempat_lahir`, `tanggal_lahir`, `agama`, `pekerjaan`, `alamat`, `lingkungan`

## `penghasilan`

**Label:** Surat Keterangan Penghasilan

**Deskripsi:** Surat keterangan penghasilan untuk keperluan administrasi

**Letter prefix:** `H.6`

**Masa berlaku:** 30 hari

**Fields wajib:**

| Field | Required |
| --- | --- |
| `nama_lengkap` | Ya |
| `jenis_kelamin` | Ya |
| `tempat_lahir` | Ya |
| `tanggal_lahir` | Ya |
| `agama` | Ya |
| `status_perkawinan` | Ya |
| `pekerjaan` | Ya |
| `kewarganegaraan` | Ya |
| `alamat` | Ya |
| `tujuan` | Ya |
| `jumlah_penghasilan` | Ya |

**File upload:**

| Field | Required | Max Count |
| --- | --- | --- |
| `ktp` | Ya | 1 |
| `kartu_keluarga` | Ya | 1 |
| `surat_lainnya` | Tidak | 1 |

**Auto populated fields:** `nama_lengkap`, `jenis_kelamin`, `tempat_lahir`, `tanggal_lahir`, `agama`, `pekerjaan`, `kewarganegaraan`, `alamat`, `lingkungan`

## `skck`

**Label:** Surat Permohonan SKCK

**Deskripsi:** Surat permohonan SKCK untuk keperluan administrasi

**Letter prefix:** `H.1`

**Masa berlaku:** 30 hari

**Fields wajib:**

| Field | Required |
| --- | --- |
| `nik` | Ya |
| `nama_lengkap` | Ya |
| `jenis_kelamin` | Ya |
| `tempat_lahir` | Ya |
| `tanggal_lahir` | Ya |
| `pekerjaan` | Ya |
| `pendidikan_terakhir` | Ya |
| `status_perkawinan` | Ya |
| `kewarganegaraan` | Ya |
| `alamat` | Ya |
| `tujuan` | Ya |

**File upload:**

| Field | Required | Max Count |
| --- | --- | --- |
| `ktp` | Ya | 1 |
| `kartu_keluarga` | Ya | 1 |
| `surat_lainnya` | Tidak | 1 |

**Auto populated fields:** `nik`, `nama_lengkap`, `jenis_kelamin`, `tempat_lahir`, `tanggal_lahir`, `pekerjaan`, `kewarganegaraan`, `alamat`, `lingkungan`

## `tidak_mampu`

**Label:** Surat Keterangan Kurang Mampu

**Deskripsi:** Surat keterangan kurang mampu untuk keperluan administrasi

**Letter prefix:** `H.6`

**Masa berlaku:** 30 hari

**Fields wajib:**

| Field | Required |
| --- | --- |
| `nama_lengkap` | Ya |
| `jenis_kelamin` | Ya |
| `tempat_lahir` | Ya |
| `tanggal_lahir` | Ya |
| `agama` | Ya |
| `pekerjaan` | Ya |
| `status_perkawinan` | Ya |
| `kewarganegaraan` | Ya |
| `alamat` | Ya |
| `tujuan` | Ya |

**File upload:**

| Field | Required | Max Count |
| --- | --- | --- |
| `ktp` | Ya | 1 |
| `kartu_keluarga` | Ya | 1 |
| `surat_lainnya` | Tidak | 1 |

**Auto populated fields:** `nama_lengkap`, `jenis_kelamin`, `tempat_lahir`, `tanggal_lahir`, `agama`, `pekerjaan`, `kewarganegaraan`, `alamat`, `lingkungan`

## `usaha`

**Label:** Surat Keterangan Usaha

**Deskripsi:** Surat keterangan usaha untuk keperluan administrasi

**Letter prefix:** `H.6`

**Masa berlaku:** 30 hari

**Fields:**

| Field | Required |
| --- | --- |
| `nama_lengkap` | Ya |
| `jenis_kelamin` | Ya |
| `tempat_lahir` | Ya |
| `tanggal_lahir` | Ya |
| `agama` | Ya |
| `pekerjaan` | Ya |
| `status_perkawinan` | Ya |
| `kewarganegaraan` | Ya |
| `alamat` | Ya |
| `nama_usaha` | Ya |

**Required fields tambahan:**

| Field | Required |
| --- | --- |
| `jenis_usaha` | Ya |

**File upload:**

| Field | Required | Max Count |
| --- | --- | --- |
| `ktp` | Ya | 1 |
| `kartu_keluarga` | Ya | 1 |
| `surat_lainnya` | Tidak | 1 |

**Auto populated fields:** `nama_lengkap`, `jenis_kelamin`, `tempat_lahir`, `tanggal_lahir`, `agama`, `pekerjaan`, `kewarganegaraan`, `alamat`, `lingkungan`
