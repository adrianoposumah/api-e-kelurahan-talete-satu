/**
 * Shared formatting functions for API responses
 */

/**
 * Format user object for API response (excludes password)
 * @param {object} user - User object from database
 * @returns {object} Formatted user object
 */
export const formatUserResponse = (user) => ({
  id: user.id.toString(),
  nik: user.nik,
  nama: user.nama,
  no_hp: user.noHp,
  role: user.role,
  is_validate: user.isValidate,
  status: user.status,
  created_at: user.createdAt,
  updated_at: user.updatedAt,
});

/**
 * Format user object with kependudukan data for API response
 * @param {object} user - User object from database with kependudukan relation
 * @returns {object} Formatted user object with kependudukan
 */
export const formatUserWithKependudukanResponse = (user) => ({
  ...formatUserResponse(user),
  kependudukan: user.isValidate && user.kependudukan ? formatKependudukanResponse(user.kependudukan) : undefined,
});

/**
 * Format kependudukan object for API response
 * @param {object} kependudukan - Kependudukan object from database
 * @returns {object} Formatted kependudukan object
 */
export const formatKependudukanResponse = (kependudukan) => ({
  nik: kependudukan.nik,
  nama: kependudukan.nama,
  tempat_lahir: kependudukan.tempatLahir,
  tanggal_lahir: kependudukan.tanggalLahir,
  jenis_kelamin: kependudukan.jenisKelamin,
  golongan_darah: kependudukan.golonganDarah,
  alamat: kependudukan.alamat,
  rt: kependudukan.rt,
  rw: kependudukan.rw,
  kelurahan: kependudukan.kelurahan,
  kecamatan: kependudukan.kecamatan,
  kabupaten_kota: kependudukan.kabupatenKota,
  provinsi: kependudukan.provinsi,
  status_kawin: kependudukan.statusKawin,
  agama: kependudukan.agama,
  pekerjaan: kependudukan.pekerjaan,
  kewarganegaraan: kependudukan.kewarganegaraan,
});

/**
 * Format validate request object for API response
 * @param {object} request - ValidateRequest object from database
 * @returns {object} Formatted validate request object
 */
export const formatValidateRequestResponse = (request) => ({
  id: request.id.toString(),
  user_id: request.userId.toString(),
  nik: request.nik,
  status: request.status,
  admin_notes: request.adminNotes,
  processed_by: request.processedBy?.toString() || null,
  processed_at: request.processedAt,
  created_at: request.createdAt,
  updated_at: request.updatedAt,
  user: request.user
    ? {
        id: request.user.id.toString(),
        nama: request.user.nama,
        no_hp: request.user.noHp,
      }
    : undefined,
  kependudukan: request.kependudukan ? formatKependudukanResponse(request.kependudukan) : undefined,
  admin: request.admin
    ? {
        id: request.admin.id.toString(),
        nama: request.admin.nama,
      }
    : undefined,
});
