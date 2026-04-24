import prisma from '../config/prisma.js';

const VALID_JENIS_KELAMIN = ['L', 'P'];
const VALID_GOLONGAN_DARAH = ['A', 'B', 'AB', 'O', 'TIDAK_DIKETAHUI'];
const VALID_STATUS_KAWIN = ['BELUM_KAWIN', 'KAWIN', 'CERAI_HIDUP', 'CERAI_MATI'];

const parseNik = (nik) => String(nik || '').trim();

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

/**
 * Kependudukan Service - Handles data kependudukan business logic
 */
class KependudukanService {
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
