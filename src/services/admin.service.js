import prisma from '../config/prisma.js';
import { sendToUser } from './notification.service.js';

const toNullableString = (value) => (value === undefined || value === null || value === '' ? null : String(value));

const buildKependudukanCreateData = (submittedData) => ({
  nik: submittedData.nik,
  nama: submittedData.nama,
  tempatLahir: submittedData.tempat_lahir,
  tanggalLahir: new Date(submittedData.tanggal_lahir),
  jenisKelamin: submittedData.jenis_kelamin,
  golonganDarah: submittedData.golongan_darah || null,
  alamat: submittedData.alamat,
  rt: submittedData.rt || null,
  rw: submittedData.rw || null,
  lingkunganId: submittedData.lingkungan_id ? BigInt(submittedData.lingkungan_id) : null,
  kelurahan: submittedData.kelurahan,
  kecamatan: submittedData.kecamatan,
  kabupatenKota: submittedData.kabupaten_kota,
  provinsi: submittedData.provinsi,
  statusKawin: submittedData.status_kawin,
  agama: submittedData.agama,
  pekerjaan: submittedData.pekerjaan,
  kewarganegaraan: toNullableString(submittedData.kewarganegaraan) || 'WNI',
});

/**
 * Admin Service - Handles admin-related business logic
 */
class AdminService {
  /**
   * Get all users with pagination and filters
   * @param {object} options - Query options
   * @returns {Promise<object>} Users and pagination info
   */
  async getUsers({ page = 1, limit = 10, status, role, search }) {
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (status) where.status = status;
    if (role) where.role = role;
    if (search) {
      where.OR = [{ nama: { contains: search, mode: 'insensitive' } }, { nik: { contains: search, mode: 'insensitive' } }];
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
      }),
      prisma.user.count({ where }),
    ]);

    return {
      users,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        total_pages: Math.ceil(total / parseInt(limit)),
      },
    };
  }

  /**
   * Get user by ID
   * @param {string} userId - User ID
   * @returns {Promise<object>} User
   * @throws {Error} If user not found
   */
  async getUserById(userId) {
    const user = await prisma.user.findUnique({
      where: { id: BigInt(userId) },
      include: {
        kependudukan: true,
      },
    });

    if (!user) {
      const error = new Error('User tidak ditemukan');
      error.code = 'NOT_FOUND';
      throw error;
    }

    return user;
  }

  /**
   * Assign staff role to user
   * @param {string} userId - User ID
   * @returns {Promise<object>} Updated user
   * @throws {Error} If user not found or role transition is invalid
   */
  async assignStaffRole(userId) {
    const user = await prisma.user.findUnique({
      where: { id: BigInt(userId) },
    });

    if (!user) {
      const error = new Error('User tidak ditemukan');
      error.code = 'NOT_FOUND';
      throw error;
    }

    if (user.role === 'staff') {
      const error = new Error('User ini sudah memiliki role staff');
      error.code = 'BAD_REQUEST';
      throw error;
    }

    if (user.role === 'admin') {
      const error = new Error('Role admin tidak dapat diubah melalui endpoint ini');
      error.code = 'BAD_REQUEST';
      throw error;
    }

    if (user.role === 'lurah' || user.role === 'sekertaris' || user.role === 'kepling') {
      const error = new Error('User dengan role struktural harus diturunkan terlebih dahulu');
      error.code = 'BAD_REQUEST';
      throw error;
    }

    const updatedUser = await prisma.user.update({
      where: { id: BigInt(userId) },
      data: { role: 'staff' },
    });

    return updatedUser;
  }

  /**
   * Demote staff role to warga
   * @param {string} userId - User ID
   * @returns {Promise<object>} Updated user
   * @throws {Error} If user not found or not staff
   */
  async demoteStaffRole(userId) {
    const user = await prisma.user.findUnique({
      where: { id: BigInt(userId) },
    });

    if (!user) {
      const error = new Error('User tidak ditemukan');
      error.code = 'NOT_FOUND';
      throw error;
    }

    if (user.role !== 'staff') {
      const error = new Error('User ini tidak memiliki role staff');
      error.code = 'BAD_REQUEST';
      throw error;
    }

    const updatedUser = await prisma.user.update({
      where: { id: BigInt(userId) },
      data: { role: 'warga' },
    });

    return updatedUser;
  }

  /**
   * Get all validation requests with pagination and filters
   * @param {object} options - Query options
   * @returns {Promise<object>} Requests and pagination info
   */
  async getValidateRequests({ page = 1, limit = 10, status }) {
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (status) where.status = status;

    const [requests, total] = await Promise.all([
      prisma.validateRequest.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
        include: {
          user: true,
          kependudukan: true,
          admin: true,
        },
      }),
      prisma.validateRequest.count({ where }),
    ]);

    return {
      requests,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        total_pages: Math.ceil(total / parseInt(limit)),
      },
    };
  }

  /**
   * Get pending validation requests that still need admin action
   * @param {object} options - Query options
   * @returns {Promise<object>} Pending requests and pagination info
   */
  async getActiveValidateRequests({ page = 1, limit = 10 }) {
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const where = { status: 'pending' };

    const [requests, total] = await Promise.all([
      prisma.validateRequest.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'asc' },
        include: {
          user: true,
          kependudukan: true,
          admin: true,
        },
      }),
      prisma.validateRequest.count({ where }),
    ]);

    return {
      requests,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        total_pages: Math.ceil(total / parseInt(limit)),
      },
    };
  }

  /**
   * Get validation request by ID
   * @param {string} requestId - Request ID
   * @returns {Promise<object>} Validation request
   * @throws {Error} If request not found
   */
  async getValidateRequestById(requestId) {
    const request = await prisma.validateRequest.findUnique({
      where: { id: BigInt(requestId) },
      include: {
        user: true,
        kependudukan: true,
        admin: true,
      },
    });

    if (!request) {
      const error = new Error('Permintaan validasi tidak ditemukan');
      error.code = 'NOT_FOUND';
      throw error;
    }

    return request;
  }

  /**
   * Process validation request (approve or reject)
   * @param {string} requestId - Request ID
   * @param {object} data - Processing data
   * @returns {Promise<object>} Updated validation request
   * @throws {Error} If request not found or already processed
   */
  async processValidateRequest(requestId, { status, adminNotes, adminId }) {
    // Find the request
    const existingRequest = await prisma.validateRequest.findUnique({
      where: { id: BigInt(requestId) },
    });

    if (!existingRequest) {
      const error = new Error('Permintaan validasi tidak ditemukan');
      error.code = 'NOT_FOUND';
      throw error;
    }

    if (existingRequest.status !== 'pending') {
      const error = new Error('Permintaan validasi ini sudah diproses');
      error.code = 'BAD_REQUEST';
      throw error;
    }

    // Use transaction to update request, create submitted data if needed,
    // and validate the user if approved.
    const result = await prisma.$transaction(async (tx) => {
      const updateData = {
        status,
        adminNotes,
        processedBy: BigInt(adminId),
        processedAt: new Date(),
      };
      let approvedNik = existingRequest.nik;

      if (status === 'approved' && existingRequest.requestType === 'submitted_data') {
        const submittedData = existingRequest.submittedData;

        if (!submittedData || !submittedData.nik) {
          const error = new Error('Data kependudukan yang diajukan tidak lengkap');
          error.code = 'BAD_REQUEST';
          throw error;
        }

        const existingData = await tx.dataKependudukan.findUnique({
          where: { nik: submittedData.nik },
        });

        if (existingData) {
          const error = new Error('Data kependudukan dengan NIK tersebut sudah ada');
          error.code = 'CONFLICT';
          throw error;
        }

        if (submittedData.lingkungan_id) {
          const lingkungan = await tx.lingkungan.findUnique({
            where: { id: BigInt(submittedData.lingkungan_id) },
          });

          if (!lingkungan) {
            const error = new Error('Lingkungan tidak ditemukan');
            error.code = 'NOT_FOUND';
            throw error;
          }
        }

        await tx.dataKependudukan.create({
          data: buildKependudukanCreateData(submittedData),
        });

        approvedNik = submittedData.nik;
        updateData.nik = submittedData.nik;
      }

      if (status === 'approved' && !approvedNik) {
        const error = new Error('NIK permintaan validasi tidak ditemukan');
        error.code = 'BAD_REQUEST';
        throw error;
      }

      const updatedRequest = await tx.validateRequest.update({
        where: { id: BigInt(requestId) },
        data: updateData,
        include: {
          user: true,
          kependudukan: true,
          admin: true,
        },
      });

      // If approved, update the user's NIK and validation status
      if (status === 'approved') {
        await tx.user.update({
          where: { id: existingRequest.userId },
          data: {
            nik: approvedNik,
            isValidate: true,
          },
        });
      }

      return updatedRequest;
    });

    const notifPayload =
      status === 'approved'
        ? {
            title: 'Validasi Akun Diterima',
            body: 'Akun Anda telah berhasil divalidasi. Anda sekarang dapat menggunakan layanan e-Kelurahan.',
            type: 'other',
            data: { info: 'validate_accepted', request_id: requestId.toString() },
          }
        : {
            title: 'Validasi Akun Ditolak',
            body: adminNotes ? `Permintaan validasi Anda ditolak. Alasan: ${adminNotes}` : 'Permintaan validasi Anda ditolak. Silakan hubungi petugas kelurahan.',
            type: 'other',
            data: { info: 'validate_rejected', request_id: requestId.toString() },
          };

    sendToUser(existingRequest.userId, notifPayload).catch((err) => {
      console.error('Gagal mengirim notifikasi validasi:', err);
    });

    return result;
  }

  // ==================== LURAH MANAGEMENT ====================

  /**
   * Get current active Lurah with profile
   * @returns {Promise<object|null>} Current Lurah with profile or null
   */
  async getCurrentLurah() {
    const lurahProfile = await prisma.lurahProfile.findFirst({
      where: { isActive: true },
      include: {
        user: {
          include: { kependudukan: true },
        },
        lurahKeys: {
          select: { status: true },
        },
      },
    });

    return lurahProfile;
  }

  /**
   * Set a user as Lurah with profile information
   * @param {object} data - Lurah data
   * @returns {Promise<object>} Created/updated Lurah profile
   * @throws {Error} If user not found or validation fails
   */
  async setLurah({ userId, nip, namaLengkap, jabatan, pangkat, mulaiMenjabat }) {
    // Find the user to promote
    const user = await prisma.user.findUnique({
      where: { id: BigInt(userId) },
    });

    if (!user) {
      const error = new Error('User tidak ditemukan');
      error.code = 'NOT_FOUND';
      throw error;
    }

    if (user.role === 'lurah') {
      const error = new Error('User ini sudah menjadi Lurah');
      error.code = 'BAD_REQUEST';
      throw error;
    }

    if (user.role === 'admin') {
      const error = new Error('Admin tidak dapat dijadikan Lurah');
      error.code = 'BAD_REQUEST';
      throw error;
    }

    if (user.role === 'sekertaris') {
      const error = new Error('Sekertaris aktif tidak dapat langsung dijadikan Lurah');
      error.code = 'BAD_REQUEST';
      throw error;
    }

    // Check if NIP already exists for a different user
    const existingNip = await prisma.lurahProfile.findFirst({
      where: {
        nip,
        NOT: { userId: BigInt(userId) },
      },
    });

    if (existingNip) {
      const error = new Error('NIP sudah digunakan oleh Lurah lain');
      error.code = 'CONFLICT';
      throw error;
    }

    // Use transaction to demote current Lurah and promote new one
    const result = await prisma.$transaction(async (tx) => {
      let previousLurah = null;

      // Find and demote current active Lurah (if exists)
      const currentLurahProfile = await tx.lurahProfile.findFirst({
        where: { isActive: true },
        include: { user: true },
      });

      if (currentLurahProfile) {
        previousLurah = currentLurahProfile.user;

        // Deactivate current Lurah profile
        await tx.lurahProfile.update({
          where: { id: currentLurahProfile.id },
          data: {
            isActive: false,
            akhirMenjabat: new Date(),
          },
        });

        // Deactivate all ACTIVE keys for the demoted Lurah
        await tx.lurahKey.updateMany({
          where: {
            lurahProfileId: currentLurahProfile.id,
            status: 'ACTIVE',
          },
          data: {
            status: 'INACTIVE',
            deactivatedAt: new Date(),
          },
        });

        // Demote current Lurah to warga
        await tx.user.update({
          where: { id: currentLurahProfile.userId },
          data: { role: 'warga' },
        });
      }

      // Promote new user to Lurah
      await tx.user.update({
        where: { id: BigInt(userId) },
        data: { role: 'lurah' },
      });

      // Create new Lurah profile (always create, don't update)
      const newLurahProfile = await tx.lurahProfile.create({
        data: {
          userId: BigInt(userId),
          nip,
          namaLengkap,
          jabatan: jabatan || 'Lurah',
          pangkat: pangkat || null,
          mulaiMenjabat: new Date(mulaiMenjabat),
          isActive: true,
        },
        include: {
          user: {
            include: { kependudukan: true },
          },
        },
      });

      return { newLurahProfile, previousLurah };
    });

    return result;
  }

  /**
   * Update Lurah profile information
   * @param {object} data - Update data
   * @returns {Promise<object>} Updated Lurah profile
   * @throws {Error} If no active Lurah exists
   */
  async updateLurahProfile({ nip, namaLengkap, jabatan, pangkat }) {
    const currentLurahProfile = await prisma.lurahProfile.findFirst({
      where: { isActive: true },
    });

    if (!currentLurahProfile) {
      const error = new Error('Tidak ada Lurah yang aktif');
      error.code = 'NOT_FOUND';
      throw error;
    }

    // Check if new NIP already exists (if changing)
    if (nip && nip !== currentLurahProfile.nip) {
      const existingNip = await prisma.lurahProfile.findFirst({
        where: {
          nip,
          NOT: { userId: currentLurahProfile.userId },
        },
      });

      if (existingNip) {
        const error = new Error('NIP sudah digunakan');
        error.code = 'CONFLICT';
        throw error;
      }
    }

    const updatedProfile = await prisma.lurahProfile.update({
      where: { id: currentLurahProfile.id },
      data: {
        ...(nip && { nip }),
        ...(namaLengkap && { namaLengkap }),
        ...(jabatan && { jabatan }),
        ...(pangkat !== undefined && { pangkat }),
      },
      include: {
        user: {
          include: { kependudukan: true },
        },
      },
    });

    return updatedProfile;
  }

  /**
   * Demote current Lurah to warga
   * @returns {Promise<object>} Demoted user
   * @throws {Error} If no Lurah exists
   */
  async demoteLurah() {
    const currentLurahProfile = await prisma.lurahProfile.findFirst({
      where: { isActive: true },
      include: { user: true },
    });

    if (!currentLurahProfile) {
      const error = new Error('Tidak ada Lurah yang aktif');
      error.code = 'NOT_FOUND';
      throw error;
    }

    const result = await prisma.$transaction(async (tx) => {
      // Deactivate Lurah profile
      await tx.lurahProfile.update({
        where: { id: currentLurahProfile.id },
        data: {
          isActive: false,
          akhirMenjabat: new Date(),
        },
      });

      // Deactivate all ACTIVE keys for the demoted Lurah
      await tx.lurahKey.updateMany({
        where: {
          lurahProfileId: currentLurahProfile.id,
          status: 'ACTIVE',
        },
        data: {
          status: 'INACTIVE',
          deactivatedAt: new Date(),
        },
      });

      // Demote user to warga
      const demotedUser = await tx.user.update({
        where: { id: currentLurahProfile.userId },
        data: { role: 'warga' },
        include: { kependudukan: true },
      });

      return demotedUser;
    });

    return result;
  }

  /**
   * Get Lurah history (all Lurah profiles)
   * @returns {Promise<object[]>} List of Lurah profiles
   */
  async getLurahHistory() {
    const profiles = await prisma.lurahProfile.findMany({
      orderBy: { mulaiMenjabat: 'desc' },
      include: {
        user: true,
      },
    });

    return profiles;
  }

  // ==================== SEKERTARIS MANAGEMENT ====================

  /**
   * Get current active Sekertaris with profile
   * @returns {Promise<object|null>} Current Sekertaris with profile or null
   */
  async getCurrentSekertaris() {
    const sekertarisProfile = await prisma.sekertarisProfile.findFirst({
      where: { isActive: true },
      include: {
        user: {
          include: { kependudukan: true },
        },
      },
    });

    return sekertarisProfile;
  }

  /**
   * Set a user as Sekertaris with profile information
   * @param {object} data - Sekertaris data
   * @returns {Promise<object>} Created/updated Sekertaris profile
   * @throws {Error} If user not found or validation fails
   */
  async setSekertaris({ userId, nip, namaLengkap, jabatan, pangkat, mulaiMenjabat }) {
    const user = await prisma.user.findUnique({
      where: { id: BigInt(userId) },
    });

    if (!user) {
      const error = new Error('User tidak ditemukan');
      error.code = 'NOT_FOUND';
      throw error;
    }

    if (user.role === 'sekertaris') {
      const error = new Error('User ini sudah menjadi Sekertaris');
      error.code = 'BAD_REQUEST';
      throw error;
    }

    if (user.role === 'admin') {
      const error = new Error('Admin tidak dapat dijadikan Sekertaris');
      error.code = 'BAD_REQUEST';
      throw error;
    }

    if (user.role === 'lurah') {
      const error = new Error('Lurah aktif tidak dapat langsung dijadikan Sekertaris');
      error.code = 'BAD_REQUEST';
      throw error;
    }

    const existingNip = await prisma.sekertarisProfile.findUnique({
      where: { nip },
    });

    if (existingNip && existingNip.userId !== BigInt(userId)) {
      const error = new Error('NIP sudah digunakan oleh Sekertaris lain');
      error.code = 'CONFLICT';
      throw error;
    }

    const result = await prisma.$transaction(async (tx) => {
      let previousSekertaris = null;

      const currentSekertarisProfile = await tx.sekertarisProfile.findFirst({
        where: { isActive: true },
        include: { user: true },
      });

      if (currentSekertarisProfile) {
        previousSekertaris = currentSekertarisProfile.user;

        await tx.sekertarisProfile.update({
          where: { id: currentSekertarisProfile.id },
          data: {
            isActive: false,
            akhirMenjabat: new Date(),
          },
        });

        await tx.user.update({
          where: { id: currentSekertarisProfile.userId },
          data: { role: 'warga' },
        });
      }

      await tx.user.update({
        where: { id: BigInt(userId) },
        data: { role: 'sekertaris' },
      });

      const newSekertarisProfile = await tx.sekertarisProfile.create({
        data: {
          userId: BigInt(userId),
          nip,
          namaLengkap,
          jabatan: jabatan || 'Sekertaris',
          pangkat: pangkat || null,
          mulaiMenjabat: new Date(mulaiMenjabat),
          isActive: true,
        },
        include: {
          user: {
            include: { kependudukan: true },
          },
        },
      });

      return { newSekertarisProfile, previousSekertaris };
    });

    return result;
  }

  /**
   * Update Sekertaris profile information
   * @param {object} data - Update data
   * @returns {Promise<object>} Updated Sekertaris profile
   * @throws {Error} If no active Sekertaris exists
   */
  async updateSekertarisProfile({ nip, namaLengkap, jabatan, pangkat }) {
    const currentSekertarisProfile = await prisma.sekertarisProfile.findFirst({
      where: { isActive: true },
    });

    if (!currentSekertarisProfile) {
      const error = new Error('Tidak ada Sekertaris yang aktif');
      error.code = 'NOT_FOUND';
      throw error;
    }

    if (nip && nip !== currentSekertarisProfile.nip) {
      const existingNip = await prisma.sekertarisProfile.findUnique({
        where: { nip },
      });

      if (existingNip) {
        const error = new Error('NIP sudah digunakan');
        error.code = 'CONFLICT';
        throw error;
      }
    }

    const updatedProfile = await prisma.sekertarisProfile.update({
      where: { id: currentSekertarisProfile.id },
      data: {
        ...(nip && { nip }),
        ...(namaLengkap && { namaLengkap }),
        ...(jabatan && { jabatan }),
        ...(pangkat !== undefined && { pangkat }),
      },
      include: {
        user: {
          include: { kependudukan: true },
        },
      },
    });

    return updatedProfile;
  }

  /**
   * Demote current Sekertaris to warga
   * @returns {Promise<object>} Demoted user
   * @throws {Error} If no Sekertaris exists
   */
  async demoteSekertaris() {
    const currentSekertarisProfile = await prisma.sekertarisProfile.findFirst({
      where: { isActive: true },
      include: { user: true },
    });

    if (!currentSekertarisProfile) {
      const error = new Error('Tidak ada Sekertaris yang aktif');
      error.code = 'NOT_FOUND';
      throw error;
    }

    const result = await prisma.$transaction(async (tx) => {
      await tx.sekertarisProfile.update({
        where: { id: currentSekertarisProfile.id },
        data: {
          isActive: false,
          akhirMenjabat: new Date(),
        },
      });

      const demotedUser = await tx.user.update({
        where: { id: currentSekertarisProfile.userId },
        data: { role: 'warga' },
        include: { kependudukan: true },
      });

      return demotedUser;
    });

    return result;
  }

  /**
   * Get Sekertaris history (all Sekertaris profiles)
   * @returns {Promise<object[]>} List of Sekertaris profiles
   */
  async getSekertarisHistory() {
    const profiles = await prisma.sekertarisProfile.findMany({
      orderBy: { mulaiMenjabat: 'desc' },
      include: {
        user: true,
      },
    });

    return profiles;
  }
}

export default new AdminService();
