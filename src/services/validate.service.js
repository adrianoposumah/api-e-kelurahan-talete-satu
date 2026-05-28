import prisma from '../config/prisma.js';

const VALID_JENIS_KELAMIN = ['L', 'P'];
const VALID_GOLONGAN_DARAH = ['A', 'B', 'AB', 'O', 'TIDAK_DIKETAHUI'];
const VALID_STATUS_KAWIN = ['BELUM_KAWIN', 'KAWIN', 'CERAI_HIDUP', 'CERAI_MATI'];

const SUBMITTED_REQUIRED_FIELDS = ['nik', 'nama', 'tempat_lahir', 'tanggal_lahir', 'jenis_kelamin', 'alamat', 'kelurahan', 'kecamatan', 'kabupaten_kota', 'provinsi', 'status_kawin', 'agama', 'pekerjaan'];

const isPresent = (value) => value !== undefined && value !== null && String(value).trim() !== '';

const parseDateValue = (dateValue, fieldName) => {
  const parsedDate = new Date(dateValue);
  if (Number.isNaN(parsedDate.getTime())) {
    const error = new Error(`${fieldName} tidak valid`);
    error.code = 'BAD_REQUEST';
    throw error;
  }
  return parsedDate;
};

const parseBigIntValue = (value, fieldName) => {
  try {
    return BigInt(value);
  } catch {
    const error = new Error(`${fieldName} harus berupa angka yang valid`);
    error.code = 'BAD_REQUEST';
    throw error;
  }
};

const assertEnumValue = (value, validValues, fieldName) => {
  if (!value) return;
  if (!validValues.includes(value)) {
    const error = new Error(`${fieldName} tidak valid. Pilihan: ${validValues.join(', ')}`);
    error.code = 'BAD_REQUEST';
    throw error;
  }
};

const normalizeSubmittedData = (payload) => {
  const missingFields = SUBMITTED_REQUIRED_FIELDS.filter((field) => !isPresent(payload[field]));

  if (missingFields.length > 0) {
    const error = new Error(`Field wajib belum diisi: ${missingFields.join(', ')}`);
    error.code = 'BAD_REQUEST';
    throw error;
  }

  const nik = String(payload.nik || '').trim();
  const tanggalLahir = parseDateValue(payload.tanggal_lahir, 'tanggal_lahir');

  assertEnumValue(payload.jenis_kelamin, VALID_JENIS_KELAMIN, 'jenis_kelamin');
  assertEnumValue(payload.golongan_darah, VALID_GOLONGAN_DARAH, 'golongan_darah');
  assertEnumValue(payload.status_kawin, VALID_STATUS_KAWIN, 'status_kawin');

  return {
    nik,
    nama: String(payload.nama).trim(),
    tempat_lahir: String(payload.tempat_lahir).trim(),
    tanggal_lahir: tanggalLahir.toISOString(),
    jenis_kelamin: payload.jenis_kelamin,
    golongan_darah: isPresent(payload.golongan_darah) ? payload.golongan_darah : null,
    alamat: String(payload.alamat).trim(),
    rt: isPresent(payload.rt) ? String(payload.rt).trim() : null,
    rw: isPresent(payload.rw) ? String(payload.rw).trim() : null,
    lingkungan_id: isPresent(payload.lingkungan_id) ? String(payload.lingkungan_id).trim() : null,
    kelurahan: String(payload.kelurahan).trim(),
    kecamatan: String(payload.kecamatan).trim(),
    kabupaten_kota: String(payload.kabupaten_kota).trim(),
    provinsi: String(payload.provinsi).trim(),
    status_kawin: payload.status_kawin,
    agama: String(payload.agama).trim(),
    pekerjaan: String(payload.pekerjaan).trim(),
    kewarganegaraan: isPresent(payload.kewarganegaraan) ? String(payload.kewarganegaraan).trim() : 'WNI',
  };
};

/**
 * Validate Service - Handles validation request business logic
 */
class ValidateService {
  /**
   * Validate NIK format
   * @param {string} nik - NIK to validate
   * @returns {boolean} True if valid
   */
  validateNikFormat(nik) {
    return nik && /^\d{16}$/.test(nik);
  }

  /**
   * Create a validation request
   * @param {string} userId - User ID
   * @param {string} nik - NIK to validate
   * @returns {Promise<object>} Created validation request
   * @throws {Error} If validation fails
   */
  async createValidateRequest(userId, nik) {
    const userIdBigInt = BigInt(userId);

    const user = await prisma.user.findUnique({
      where: { id: userIdBigInt },
      include: {
        kependudukan: true,
      },
    });

    if (!user) {
      const error = new Error('User tidak ditemukan');
      error.code = 'NOT_FOUND';
      throw error;
    }

    // A structural role alone must not block population validation.
    // Treat the account as fully validated only when it is linked to a NIK
    // and that NIK resolves to data kependudukan.
    const isAlreadyValidated = user.isValidate && user.nik && user.kependudukan;
    if (isAlreadyValidated) {
      const error = new Error('Akun anda sudah tervalidasi');
      error.code = 'BAD_REQUEST';
      throw error;
    }

    // Check if NIK exists in data_kependudukan
    const kependudukan = await prisma.dataKependudukan.findUnique({
      where: { nik },
    });

    if (!kependudukan) {
      const error = new Error('NIK tidak ditemukan dalam data kependudukan');
      error.code = 'NOT_FOUND';
      throw error;
    }

    // Check if NIK is already used by another user
    const existingUserWithNik = await prisma.user.findUnique({
      where: { nik },
    });

    if (existingUserWithNik && existingUserWithNik.id !== userIdBigInt) {
      const error = new Error('NIK sudah digunakan oleh pengguna lain');
      error.code = 'CONFLICT';
      throw error;
    }

    // Check if there's already a pending request for this user
    const existingRequest = await prisma.validateRequest.findFirst({
      where: {
        userId: userIdBigInt,
        status: 'pending',
      },
    });

    if (existingRequest) {
      const error = new Error('Anda sudah memiliki permintaan validasi yang sedang diproses');
      error.code = 'CONFLICT';
      throw error;
    }

    // Create validation request
    const validateRequest = await prisma.validateRequest.create({
      data: {
        userId: userIdBigInt,
        nik,
        requestType: 'existing_data',
      },
      include: {
        user: true,
        kependudukan: true,
      },
    });

    return validateRequest;
  }

  /**
   * Submit kependudukan data as a validation request. If the NIK already
   * exists, only the NIK is used. Otherwise, submitted data is stored on the
   * request and inserted into data_kependudukan after admin approval.
   * @param {string} userId - User ID
   * @param {object} payload - Submitted kependudukan data
   * @returns {Promise<object>} Created validation request
   */
  async submitData(userId, payload) {
    const userIdBigInt = BigInt(userId);
    const submittedNik = String(payload?.nik || '').trim();

    if (!this.validateNikFormat(submittedNik)) {
      const error = new Error('NIK harus 16 digit angka');
      error.code = 'BAD_REQUEST';
      throw error;
    }

    const user = await prisma.user.findUnique({
      where: { id: userIdBigInt },
      include: {
        kependudukan: true,
      },
    });

    if (!user) {
      const error = new Error('User tidak ditemukan');
      error.code = 'NOT_FOUND';
      throw error;
    }

    const isAlreadyValidated = user.isValidate && user.nik && user.kependudukan;
    if (isAlreadyValidated) {
      const error = new Error('Akun anda sudah tervalidasi');
      error.code = 'BAD_REQUEST';
      throw error;
    }

    const existingData = await prisma.dataKependudukan.findUnique({
      where: { nik: submittedNik },
    });

    const existingUserWithNik = await prisma.user.findUnique({
      where: { nik: submittedNik },
    });

    if (existingUserWithNik && existingUserWithNik.id !== userIdBigInt) {
      const error = new Error('NIK sudah digunakan oleh pengguna lain');
      error.code = 'CONFLICT';
      throw error;
    }

    const existingRequest = await prisma.validateRequest.findFirst({
      where: {
        userId: userIdBigInt,
        status: 'pending',
      },
    });

    if (existingRequest) {
      const error = new Error('Anda sudah memiliki permintaan validasi yang sedang diproses');
      error.code = 'CONFLICT';
      throw error;
    }

    if (existingData) {
      const validateRequest = await prisma.validateRequest.create({
        data: {
          userId: userIdBigInt,
          nik: submittedNik,
          requestType: 'existing_data',
        },
        include: {
          user: true,
          kependudukan: true,
        },
      });

      return validateRequest;
    }

    const submittedData = normalizeSubmittedData(payload);

    if (submittedData.lingkungan_id) {
      const lingkungan = await prisma.lingkungan.findUnique({
        where: { id: parseBigIntValue(submittedData.lingkungan_id, 'lingkungan_id') },
      });

      if (!lingkungan) {
        const error = new Error('Lingkungan tidak ditemukan');
        error.code = 'NOT_FOUND';
        throw error;
      }
    }

    const duplicatePendingNik = await prisma.validateRequest.findFirst({
      where: {
        status: 'pending',
        requestType: 'submitted_data',
        submittedData: {
          path: ['nik'],
          equals: submittedData.nik,
        },
      },
    });

    if (duplicatePendingNik) {
      const error = new Error('NIK sedang diajukan dalam permintaan validasi lain');
      error.code = 'CONFLICT';
      throw error;
    }

    const validateRequest = await prisma.validateRequest.create({
      data: {
        userId: userIdBigInt,
        nik: null,
        requestType: 'submitted_data',
        submittedData,
      },
      include: {
        user: true,
        kependudukan: true,
      },
    });

    return validateRequest;
  }

  /**
   * Get validation requests for a user
   * @param {string} userId - User ID
   * @returns {Promise<array>} List of validation requests
   */
  async getUserValidateRequests(userId) {
    const requests = await prisma.validateRequest.findMany({
      where: { userId: BigInt(userId) },
      orderBy: { createdAt: 'desc' },
      include: {
        kependudukan: true,
        admin: true,
      },
    });

    return requests;
  }
}

export default new ValidateService();
