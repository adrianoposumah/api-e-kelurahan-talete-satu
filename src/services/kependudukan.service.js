import prisma from '../config/prisma.js';
import XLSX from 'xlsx';

const VALID_JENIS_KELAMIN = ['L', 'P'];
const VALID_GOLONGAN_DARAH = ['A', 'B', 'AB', 'O', 'TIDAK_DIKETAHUI'];
const VALID_STATUS_KAWIN = ['BELUM_KAWIN', 'KAWIN', 'CERAI_HIDUP', 'CERAI_MATI'];

const BATCH_REQUIRED_FIELDS = ['nik', 'nama', 'tempatLahir', 'tanggalLahir', 'jenisKelamin', 'alamat', 'kelurahan', 'kecamatan', 'kabupatenKota', 'provinsi', 'statusKawin', 'agama', 'pekerjaan'];

const BATCH_FIELD_ALIASES = {
  nik: ['nik'],
  nama: ['nama'],
  tempatLahir: ['tempatlahir', 'tempat_lahir', 'tempat lahir'],
  tanggalLahir: ['tanggallahir', 'tanggal_lahir', 'tanggal lahir'],
  jenisKelamin: ['jeniskelamin', 'jenis_kelamin', 'jenis kelamin'],
  golonganDarah: ['golongandarah', 'golongan_darah', 'golongan darah'],
  alamat: ['alamat'],
  rt: ['rt'],
  rw: ['rw'],
  lingkunganId: ['lingkunganid', 'lingkungan_id', 'lingkungan id'],
  kelurahan: ['kelurahan'],
  kecamatan: ['kecamatan'],
  kabupatenKota: ['kabupatenkota', 'kabupaten_kota', 'kabupaten kota'],
  provinsi: ['provinsi'],
  statusKawin: ['statuskawin', 'status_kawin', 'status kawin'],
  agama: ['agama'],
  pekerjaan: ['pekerjaan'],
  kewarganegaraan: ['kewarganegaraan'],
};

const parseNik = (nik) => String(nik || '').trim();

const isPresent = (value) => value !== undefined && value !== null && String(value).trim() !== '';

const normalizeEnumToken = (value) => {
  if (!isPresent(value)) return null;
  return String(value).trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
};

const normalizeHeader = (header) =>
  String(header || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const normalizeRow = (row) => {
  const normalized = {};
  Object.entries(row).forEach(([key, value]) => {
    normalized[normalizeHeader(key)] = value;
  });
  return normalized;
};

const toNullableString = (value) => {
  if (!isPresent(value)) return null;
  return String(value).trim();
};

const normalizeBatchJenisKelamin = (value) => {
  const token = normalizeEnumToken(value);
  if (!token) return null;

  if (['l', 'laki laki', 'lakilaki', 'pria', 'male'].includes(token)) return 'L';
  if (['p', 'perempuan', 'wanita', 'female'].includes(token)) return 'P';

  return toNullableString(value);
};

const normalizeBatchGolonganDarah = (value) => {
  if (!isPresent(value)) return null;

  const rawValue = String(value).trim().toUpperCase();
  if (['A', 'B', 'AB', 'O'].includes(rawValue)) return rawValue;

  const token = normalizeEnumToken(value);
  if (['tidak diketahui', 'unknown', 'tidak tahu', 'tahu'].includes(token)) return 'TIDAK_DIKETAHUI';
  if (String(value).trim() === '-') return 'TIDAK_DIKETAHUI';

  return toNullableString(value);
};

const normalizeBatchStatusKawin = (value) => {
  const token = normalizeEnumToken(value);
  if (!token) return null;

  if (['belum kawin', 'single', 'belum menikah', 'lajang'].includes(token)) return 'BELUM_KAWIN';
  if (['kawin', 'menikah', 'married'].includes(token)) return 'KAWIN';
  if (['cerai hidup', 'divorced'].includes(token)) return 'CERAI_HIDUP';
  if (['cerai mati', 'ditinggal mati', 'widow', 'widower'].includes(token)) return 'CERAI_MATI';

  return toNullableString(value);
};

const mapRowToPayload = (row) => {
  const normalized = normalizeRow(row);

  const getValue = (aliases) => {
    for (const alias of aliases) {
      const value = normalized[normalizeHeader(alias)];
      if (value !== undefined) return value;
    }
    return undefined;
  };

  return {
    nik: toNullableString(getValue(BATCH_FIELD_ALIASES.nik)),
    nama: toNullableString(getValue(BATCH_FIELD_ALIASES.nama)),
    tempatLahir: toNullableString(getValue(BATCH_FIELD_ALIASES.tempatLahir)),
    tanggalLahir: getValue(BATCH_FIELD_ALIASES.tanggalLahir),
    jenisKelamin: normalizeBatchJenisKelamin(getValue(BATCH_FIELD_ALIASES.jenisKelamin)),
    golonganDarah: normalizeBatchGolonganDarah(getValue(BATCH_FIELD_ALIASES.golonganDarah)),
    alamat: toNullableString(getValue(BATCH_FIELD_ALIASES.alamat)),
    rt: toNullableString(getValue(BATCH_FIELD_ALIASES.rt)),
    rw: toNullableString(getValue(BATCH_FIELD_ALIASES.rw)),
    lingkunganId: toNullableString(getValue(BATCH_FIELD_ALIASES.lingkunganId)),
    kelurahan: toNullableString(getValue(BATCH_FIELD_ALIASES.kelurahan)),
    kecamatan: toNullableString(getValue(BATCH_FIELD_ALIASES.kecamatan)),
    kabupatenKota: toNullableString(getValue(BATCH_FIELD_ALIASES.kabupatenKota)),
    provinsi: toNullableString(getValue(BATCH_FIELD_ALIASES.provinsi)),
    statusKawin: normalizeBatchStatusKawin(getValue(BATCH_FIELD_ALIASES.statusKawin)),
    agama: toNullableString(getValue(BATCH_FIELD_ALIASES.agama)),
    pekerjaan: toNullableString(getValue(BATCH_FIELD_ALIASES.pekerjaan)),
    kewarganegaraan: toNullableString(getValue(BATCH_FIELD_ALIASES.kewarganegaraan)),
  };
};

const parseDateValue = (dateValue, fieldName) => {
  if (typeof dateValue === 'number') {
    const dateCode = XLSX.SSF.parse_date_code(dateValue);
    if (dateCode) {
      return new Date(Date.UTC(dateCode.y, dateCode.m - 1, dateCode.d));
    }
  }

  if (typeof dateValue === 'string' && /^\d+(\.\d+)?$/.test(dateValue.trim())) {
    const numericValue = Number(dateValue);
    const dateCode = XLSX.SSF.parse_date_code(numericValue);
    if (dateCode) {
      return new Date(Date.UTC(dateCode.y, dateCode.m - 1, dateCode.d));
    }
  }

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

/**
 * Kependudukan Service - Handles data kependudukan business logic
 */
class KependudukanService {
  /**
   * Batch create data from XLSX
   * @param {Buffer} fileBuffer - Uploaded XLSX file buffer
   * @returns {Promise<object>} Batch processing summary
   */
  async batchCreateDataFromXlsx(fileBuffer) {
    let workbook;

    try {
      workbook = XLSX.read(fileBuffer, {
        type: 'buffer',
        cellDates: true,
      });
    } catch {
      const error = new Error('File Excel tidak valid atau tidak dapat dibaca');
      error.code = 'BAD_REQUEST';
      throw error;
    }

    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      const error = new Error('File Excel tidak memiliki sheet');
      error.code = 'BAD_REQUEST';
      throw error;
    }

    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, {
      defval: null,
      raw: true,
    });

    if (rows.length === 0) {
      const error = new Error('File Excel tidak memiliki data');
      error.code = 'BAD_REQUEST';
      throw error;
    }

    const created = [];
    const failed = [];

    for (let i = 0; i < rows.length; i += 1) {
      const rowNumber = i + 2;

      try {
        const payload = mapRowToPayload(rows[i]);
        const missingFields = BATCH_REQUIRED_FIELDS.filter((field) => !isPresent(payload[field]));

        if (missingFields.length > 0) {
          failed.push({
            row: rowNumber,
            message: `Field wajib belum diisi: ${missingFields.join(', ')}`,
          });
          continue;
        }

        const createdData = await this.createData(payload);

        created.push({
          row: rowNumber,
          nik: createdData.nik,
          nama: createdData.nama,
        });
      } catch (error) {
        failed.push({
          row: rowNumber,
          message: error.message,
        });
      }
    }

    return {
      total_rows: rows.length,
      created_count: created.length,
      failed_count: failed.length,
      created,
      failed,
      expected_columns: Object.keys(BATCH_FIELD_ALIASES),
    };
  }

  /**
   * Get all data kependudukan with pagination and filters
   * @param {object} options - Query options
   * @returns {Promise<object>} Data and pagination info
   */
  async getAllData({ page = 1, limit = 10, search, lingkunganId, jenisKelamin, statusKawin }) {
    const pageNumber = parseInt(page, 10) || 1;
    const limitNumber = parseInt(limit, 10) || 10;
    const skip = (pageNumber - 1) * limitNumber;

    assertEnumValue(jenisKelamin, VALID_JENIS_KELAMIN, 'jenis_kelamin');
    assertEnumValue(statusKawin, VALID_STATUS_KAWIN, 'status_kawin');

    const where = {};

    if (search) {
      where.OR = [{ nik: { contains: search } }, { nama: { contains: search, mode: 'insensitive' } }];
    }

    if (lingkunganId) {
      where.lingkunganId = parseBigIntValue(lingkunganId, 'lingkungan_id');
    }

    if (jenisKelamin) {
      where.jenisKelamin = jenisKelamin;
    }

    if (statusKawin) {
      where.statusKawin = statusKawin;
    }

    const [data, total] = await Promise.all([
      prisma.dataKependudukan.findMany({
        where,
        skip,
        take: limitNumber,
        orderBy: { nama: 'asc' },
        include: {
          lingkungan: true,
          user: {
            select: {
              id: true,
              nama: true,
              role: true,
              isValidate: true,
            },
          },
        },
      }),
      prisma.dataKependudukan.count({ where }),
    ]);

    return {
      data,
      pagination: {
        page: pageNumber,
        limit: limitNumber,
        total,
        total_pages: Math.ceil(total / limitNumber),
      },
    };
  }

  /**
   * Get data kependudukan by NIK
   * @param {string} nik - NIK
   * @returns {Promise<object>} Data kependudukan
   */
  async getByNik(nik) {
    const parsedNik = parseNik(nik);

    const data = await prisma.dataKependudukan.findUnique({
      where: { nik: parsedNik },
      include: {
        lingkungan: true,
        user: {
          select: {
            id: true,
            nama: true,
            role: true,
            isValidate: true,
          },
        },
      },
    });

    if (!data) {
      const error = new Error('Data kependudukan tidak ditemukan');
      error.code = 'NOT_FOUND';
      throw error;
    }

    return data;
  }

  /**
   * Create data kependudukan
   * @param {object} payload - Kependudukan payload
   * @returns {Promise<object>} Created data
   */
  async createData(payload) {
    const parsedNik = parseNik(payload.nik);

    if (!/^\d{16}$/.test(parsedNik)) {
      const error = new Error('NIK harus terdiri dari 16 digit angka');
      error.code = 'BAD_REQUEST';
      throw error;
    }

    assertEnumValue(payload.jenisKelamin, VALID_JENIS_KELAMIN, 'jenis_kelamin');
    assertEnumValue(payload.golonganDarah, VALID_GOLONGAN_DARAH, 'golongan_darah');
    assertEnumValue(payload.statusKawin, VALID_STATUS_KAWIN, 'status_kawin');

    const existing = await prisma.dataKependudukan.findUnique({
      where: { nik: parsedNik },
    });

    if (existing) {
      const error = new Error('Data kependudukan dengan NIK tersebut sudah ada');
      error.code = 'CONFLICT';
      throw error;
    }

    let parsedLingkunganId = null;
    if (payload.lingkunganId) {
      parsedLingkunganId = parseBigIntValue(payload.lingkunganId, 'lingkungan_id');

      const lingkungan = await prisma.lingkungan.findUnique({
        where: { id: parsedLingkunganId },
      });

      if (!lingkungan) {
        const error = new Error('Lingkungan tidak ditemukan');
        error.code = 'NOT_FOUND';
        throw error;
      }
    }

    const data = await prisma.dataKependudukan.create({
      data: {
        nik: parsedNik,
        nama: payload.nama,
        tempatLahir: payload.tempatLahir,
        tanggalLahir: parseDateValue(payload.tanggalLahir, 'tanggal_lahir'),
        jenisKelamin: payload.jenisKelamin,
        golonganDarah: payload.golonganDarah || null,
        alamat: payload.alamat,
        rt: payload.rt || null,
        rw: payload.rw || null,
        lingkunganId: parsedLingkunganId,
        kelurahan: payload.kelurahan,
        kecamatan: payload.kecamatan,
        kabupatenKota: payload.kabupatenKota,
        provinsi: payload.provinsi,
        statusKawin: payload.statusKawin,
        agama: payload.agama,
        pekerjaan: payload.pekerjaan,
        kewarganegaraan: payload.kewarganegaraan || 'WNI',
      },
      include: {
        lingkungan: true,
        user: {
          select: {
            id: true,
            nama: true,
            role: true,
            isValidate: true,
          },
        },
      },
    });

    return data;
  }

  /**
   * Update data kependudukan
   * @param {string} nik - NIK
   * @param {object} payload - Update payload
   * @returns {Promise<object>} Updated data
   */
  async updateData(nik, payload) {
    const parsedNik = parseNik(nik);

    const existing = await prisma.dataKependudukan.findUnique({
      where: { nik: parsedNik },
    });

    if (!existing) {
      const error = new Error('Data kependudukan tidak ditemukan');
      error.code = 'NOT_FOUND';
      throw error;
    }

    assertEnumValue(payload.jenisKelamin, VALID_JENIS_KELAMIN, 'jenis_kelamin');
    assertEnumValue(payload.golonganDarah, VALID_GOLONGAN_DARAH, 'golongan_darah');
    assertEnumValue(payload.statusKawin, VALID_STATUS_KAWIN, 'status_kawin');

    const updateData = {};

    if (payload.nama !== undefined) updateData.nama = payload.nama;
    if (payload.tempatLahir !== undefined) updateData.tempatLahir = payload.tempatLahir;
    if (payload.tanggalLahir !== undefined) {
      updateData.tanggalLahir = parseDateValue(payload.tanggalLahir, 'tanggal_lahir');
    }
    if (payload.jenisKelamin !== undefined) updateData.jenisKelamin = payload.jenisKelamin;
    if (payload.golonganDarah !== undefined) updateData.golonganDarah = payload.golonganDarah || null;
    if (payload.alamat !== undefined) updateData.alamat = payload.alamat;
    if (payload.rt !== undefined) updateData.rt = payload.rt || null;
    if (payload.rw !== undefined) updateData.rw = payload.rw || null;
    if (payload.kelurahan !== undefined) updateData.kelurahan = payload.kelurahan;
    if (payload.kecamatan !== undefined) updateData.kecamatan = payload.kecamatan;
    if (payload.kabupatenKota !== undefined) updateData.kabupatenKota = payload.kabupatenKota;
    if (payload.provinsi !== undefined) updateData.provinsi = payload.provinsi;
    if (payload.statusKawin !== undefined) updateData.statusKawin = payload.statusKawin;
    if (payload.agama !== undefined) updateData.agama = payload.agama;
    if (payload.pekerjaan !== undefined) updateData.pekerjaan = payload.pekerjaan;
    if (payload.kewarganegaraan !== undefined) updateData.kewarganegaraan = payload.kewarganegaraan;

    if (payload.lingkunganId !== undefined) {
      if (payload.lingkunganId === null || payload.lingkunganId === '') {
        updateData.lingkunganId = null;
      } else {
        const parsedLingkunganId = parseBigIntValue(payload.lingkunganId, 'lingkungan_id');

        const lingkungan = await prisma.lingkungan.findUnique({
          where: { id: parsedLingkunganId },
        });

        if (!lingkungan) {
          const error = new Error('Lingkungan tidak ditemukan');
          error.code = 'NOT_FOUND';
          throw error;
        }

        updateData.lingkunganId = parsedLingkunganId;
      }
    }

    if (Object.keys(updateData).length === 0) {
      const error = new Error('Tidak ada data yang diupdate');
      error.code = 'BAD_REQUEST';
      throw error;
    }

    const updatedData = await prisma.dataKependudukan.update({
      where: { nik: parsedNik },
      data: updateData,
      include: {
        lingkungan: true,
        user: {
          select: {
            id: true,
            nama: true,
            role: true,
            isValidate: true,
          },
        },
      },
    });

    return updatedData;
  }

  /**
   * Delete data kependudukan by NIK
   * @param {string} nik - NIK
   * @returns {Promise<void>}
   */
  async deleteData(nik) {
    const parsedNik = parseNik(nik);

    const existing = await prisma.dataKependudukan.findUnique({
      where: { nik: parsedNik },
      include: {
        user: {
          select: {
            id: true,
            nama: true,
          },
        },
        _count: {
          select: {
            validateRequests: true,
          },
        },
      },
    });

    if (!existing) {
      const error = new Error('Data kependudukan tidak ditemukan');
      error.code = 'NOT_FOUND';
      throw error;
    }

    if (existing.user) {
      const error = new Error('Data kependudukan tidak dapat dihapus karena sudah terhubung dengan user');
      error.code = 'BAD_REQUEST';
      throw error;
    }

    if (existing._count.validateRequests > 0) {
      const error = new Error('Data kependudukan tidak dapat dihapus karena memiliki riwayat validasi');
      error.code = 'BAD_REQUEST';
      throw error;
    }

    await prisma.dataKependudukan.delete({
      where: { nik: parsedNik },
    });
  }
}

export default new KependudukanService();
