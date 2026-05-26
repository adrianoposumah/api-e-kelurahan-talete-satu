import adminService from '../services/admin.service.js';
import { formatUserResponse, formatUserWithKependudukanResponse, formatValidateRequestResponse, formatLurahProfileResponse, formatSekertarisProfileResponse } from '../utils/formatters.js';

/**
 * Admin Controller - Handles admin request/response
 */
class AdminController {
  /**
   * GET /admin/users - Get all users with pagination
   */
  async getUsers(req, res, next) {
    try {
      const { page, limit, status, role, search } = req.query;

      const { users, pagination } = await adminService.getUsers({
        page,
        limit,
        status,
        role,
        search,
      });

      res.json({
        data: users.map(formatUserResponse),
        pagination,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /admin/users/:id - Get user by ID
   */
  async getUserById(req, res, next) {
    try {
      const { id } = req.params;

      const user = await adminService.getUserById(id);

      res.json(formatUserWithKependudukanResponse(user));
    } catch (error) {
      if (error.code === 'NOT_FOUND') {
        return res.status(404).json({
          error: 'Not Found',
          message: error.message,
        });
      }
      next(error);
    }
  }

  /**
   * PATCH /admin/users/:id/assign-staff - Assign staff role
   */
  async assignStaffRole(req, res, next) {
    try {
      const { id } = req.params;

      const user = await adminService.assignStaffRole(id);

      res.json({
        message: `${user.nama} berhasil diberi role staff`,
        data: formatUserResponse(user),
      });
    } catch (error) {
      if (error.code === 'NOT_FOUND') {
        return res.status(404).json({
          error: 'Not Found',
          message: error.message,
        });
      }
      if (error.code === 'BAD_REQUEST') {
        return res.status(400).json({
          error: 'Bad Request',
          message: error.message,
        });
      }
      next(error);
    }
  }

  /**
   * PATCH /admin/users/:id/demote-staff - Demote staff role to warga
   */
  async demoteStaffRole(req, res, next) {
    try {
      const { id } = req.params;

      const user = await adminService.demoteStaffRole(id);

      res.json({
        message: `${user.nama} berhasil diturunkan dari role staff menjadi warga`,
        data: formatUserResponse(user),
      });
    } catch (error) {
      if (error.code === 'NOT_FOUND') {
        return res.status(404).json({
          error: 'Not Found',
          message: error.message,
        });
      }
      if (error.code === 'BAD_REQUEST') {
        return res.status(400).json({
          error: 'Bad Request',
          message: error.message,
        });
      }
      next(error);
    }
  }

  /**
   * GET /admin/validate-requests - Get all validation requests with pagination
   */
  async getValidateRequests(req, res, next) {
    try {
      const { page, limit, status } = req.query;

      const { requests, pagination } = await adminService.getValidateRequests({
        page,
        limit,
        status,
      });

      res.json({
        data: requests.map(formatValidateRequestResponse),
        pagination,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /admin/validate-requests/active - Get pending validation requests that need action
   */
  async getActiveValidateRequests(req, res, next) {
    try {
      const { page, limit } = req.query;

      const { requests, pagination } = await adminService.getActiveValidateRequests({
        page,
        limit,
      });

      res.json({
        data: requests.map(formatValidateRequestResponse),
        pagination,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /admin/validate-requests/:id - Get validation request by ID
   */
  async getValidateRequestById(req, res, next) {
    try {
      const { id } = req.params;

      const request = await adminService.getValidateRequestById(id);

      res.json(formatValidateRequestResponse(request));
    } catch (error) {
      if (error.code === 'NOT_FOUND') {
        return res.status(404).json({
          error: 'Not Found',
          message: error.message,
        });
      }
      next(error);
    }
  }

  /**
   * PATCH /admin/validate-requests/:id - Process validation request
   */
  async processValidateRequest(req, res, next) {
    try {
      const { id } = req.params;
      const { status, admin_notes } = req.body;

      // Validate status
      if (!status || !['approved', 'rejected'].includes(status)) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Status harus "approved" atau "rejected"',
        });
      }

      const result = await adminService.processValidateRequest(id, {
        status,
        adminNotes: admin_notes,
        adminId: req.user.userId,
      });

      res.json({
        message: status === 'approved' ? 'Permintaan validasi berhasil disetujui' : 'Permintaan validasi ditolak',
        data: formatValidateRequestResponse(result),
      });
    } catch (error) {
      if (error.code === 'NOT_FOUND') {
        return res.status(404).json({
          error: 'Not Found',
          message: error.message,
        });
      }
      if (error.code === 'BAD_REQUEST') {
        return res.status(400).json({
          error: 'Bad Request',
          message: error.message,
        });
      }
      next(error);
    }
  }

  // ==================== LURAH MANAGEMENT ====================

  /**
   * GET /admin/lurah - Get current Lurah
   */
  async getCurrentLurah(req, res, next) {
    try {
      const lurahProfile = await adminService.getCurrentLurah();

      if (!lurahProfile) {
        return res.json({
          message: 'Belum ada Lurah yang ditunjuk',
          data: null,
        });
      }

      const hasActiveKey = lurahProfile.lurahKeys?.some((key) => key.status === 'ACTIVE');
      const hasRevokedKey = lurahProfile.lurahKeys?.some((key) => key.status === 'REVOKED');
      const keyStatus = hasActiveKey ? 'active' : hasRevokedKey ? 'revoked' : 'no-key';

      res.json({
        message: 'Data Lurah berhasil diambil',
        data: {
          ...formatLurahProfileResponse(lurahProfile),
          key_status: keyStatus,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /admin/lurah - Set a user as Lurah
   */
  async setLurah(req, res, next) {
    try {
      const { user_id, nip, nama_lengkap, jabatan, pangkat, mulai_menjabat } = req.body;

      // Validate required fields
      if (!user_id) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'user_id wajib diisi',
        });
      }

      if (!nip) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'NIP wajib diisi',
        });
      }

      if (!nama_lengkap) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'nama_lengkap wajib diisi',
        });
      }

      if (!mulai_menjabat) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'mulai_menjabat wajib diisi',
        });
      }

      // Validate NIP format (18 digits)
      if (!/^\d{18}$/.test(nip)) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'NIP harus terdiri dari 18 digit angka',
        });
      }

      const { newLurahProfile, previousLurah } = await adminService.setLurah({
        userId: user_id,
        nip,
        namaLengkap: nama_lengkap,
        jabatan,
        pangkat,
        mulaiMenjabat: mulai_menjabat,
      });

      res.status(201).json({
        message: previousLurah ? `${newLurahProfile.namaLengkap} berhasil ditunjuk sebagai Lurah. ${previousLurah.nama} telah diturunkan menjadi warga.` : `${newLurahProfile.namaLengkap} berhasil ditunjuk sebagai Lurah`,
        data: {
          lurah_profile: formatLurahProfileResponse(newLurahProfile),
          previous_lurah: previousLurah ? formatUserResponse(previousLurah) : null,
        },
      });
    } catch (error) {
      if (error.code === 'NOT_FOUND') {
        return res.status(404).json({
          error: 'Not Found',
          message: error.message,
        });
      }
      if (error.code === 'BAD_REQUEST') {
        return res.status(400).json({
          error: 'Bad Request',
          message: error.message,
        });
      }
      if (error.code === 'CONFLICT') {
        return res.status(409).json({
          error: 'Conflict',
          message: error.message,
        });
      }
      next(error);
    }
  }

  /**
   * PATCH /admin/lurah - Update current Lurah profile
   */
  async updateLurahProfile(req, res, next) {
    try {
      const { nip, nama_lengkap, jabatan, pangkat } = req.body;

      // Validate NIP format if provided
      if (nip && !/^\d{18}$/.test(nip)) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'NIP harus terdiri dari 18 digit angka',
        });
      }

      const updatedProfile = await adminService.updateLurahProfile({
        nip,
        namaLengkap: nama_lengkap,
        jabatan,
        pangkat,
      });

      res.json({
        message: 'Profil Lurah berhasil diperbarui',
        data: formatLurahProfileResponse(updatedProfile),
      });
    } catch (error) {
      if (error.code === 'NOT_FOUND') {
        return res.status(404).json({
          error: 'Not Found',
          message: error.message,
        });
      }
      if (error.code === 'CONFLICT') {
        return res.status(409).json({
          error: 'Conflict',
          message: error.message,
        });
      }
      next(error);
    }
  }

  /**
   * DELETE /admin/lurah - Demote current Lurah
   */
  async demoteLurah(req, res, next) {
    try {
      const demotedUser = await adminService.demoteLurah();

      res.json({
        message: `${demotedUser.nama} telah diturunkan dari jabatan Lurah menjadi warga`,
        data: formatUserResponse(demotedUser),
      });
    } catch (error) {
      if (error.code === 'NOT_FOUND') {
        return res.status(404).json({
          error: 'Not Found',
          message: error.message,
        });
      }
      next(error);
    }
  }

  /**
   * GET /admin/lurah/history - Get Lurah history
   */
  async getLurahHistory(req, res, next) {
    try {
      const profiles = await adminService.getLurahHistory();

      res.json({
        message: 'Riwayat Lurah berhasil diambil',
        data: profiles.map(formatLurahProfileResponse),
      });
    } catch (error) {
      next(error);
    }
  }

  // ==================== SEKERTARIS MANAGEMENT ====================

  /**
   * GET /admin/sekertaris - Get current Sekertaris
   */
  async getCurrentSekertaris(req, res, next) {
    try {
      const sekertarisProfile = await adminService.getCurrentSekertaris();

      if (!sekertarisProfile) {
        return res.json({
          message: 'Belum ada Sekertaris yang ditunjuk',
          data: null,
        });
      }

      res.json({
        message: 'Data Sekertaris berhasil diambil',
        data: formatSekertarisProfileResponse(sekertarisProfile),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /admin/sekertaris - Set a user as Sekertaris
   */
  async setSekertaris(req, res, next) {
    try {
      const { user_id, nip, nama_lengkap, jabatan, pangkat, mulai_menjabat } = req.body;

      if (!user_id) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'user_id wajib diisi',
        });
      }

      if (!nip) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'NIP wajib diisi',
        });
      }

      if (!nama_lengkap) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'nama_lengkap wajib diisi',
        });
      }

      if (!mulai_menjabat) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'mulai_menjabat wajib diisi',
        });
      }

      if (!/^\d{18}$/.test(nip)) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'NIP harus terdiri dari 18 digit angka',
        });
      }

      const { newSekertarisProfile, previousSekertaris } = await adminService.setSekertaris({
        userId: user_id,
        nip,
        namaLengkap: nama_lengkap,
        jabatan,
        pangkat,
        mulaiMenjabat: mulai_menjabat,
      });

      res.status(201).json({
        message: previousSekertaris
          ? `${newSekertarisProfile.namaLengkap} berhasil ditunjuk sebagai Sekertaris. ${previousSekertaris.nama} telah diturunkan menjadi warga.`
          : `${newSekertarisProfile.namaLengkap} berhasil ditunjuk sebagai Sekertaris`,
        data: {
          sekertaris_profile: formatSekertarisProfileResponse(newSekertarisProfile),
          previous_sekertaris: previousSekertaris ? formatUserResponse(previousSekertaris) : null,
        },
      });
    } catch (error) {
      if (error.code === 'NOT_FOUND') {
        return res.status(404).json({
          error: 'Not Found',
          message: error.message,
        });
      }
      if (error.code === 'BAD_REQUEST') {
        return res.status(400).json({
          error: 'Bad Request',
          message: error.message,
        });
      }
      if (error.code === 'CONFLICT') {
        return res.status(409).json({
          error: 'Conflict',
          message: error.message,
        });
      }
      next(error);
    }
  }

  /**
   * PATCH /admin/sekertaris - Update current Sekertaris profile
   */
  async updateSekertarisProfile(req, res, next) {
    try {
      const { nip, nama_lengkap, jabatan, pangkat } = req.body;

      if (nip && !/^\d{18}$/.test(nip)) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'NIP harus terdiri dari 18 digit angka',
        });
      }

      const updatedProfile = await adminService.updateSekertarisProfile({
        nip,
        namaLengkap: nama_lengkap,
        jabatan,
        pangkat,
      });

      res.json({
        message: 'Profil Sekertaris berhasil diperbarui',
        data: formatSekertarisProfileResponse(updatedProfile),
      });
    } catch (error) {
      if (error.code === 'NOT_FOUND') {
        return res.status(404).json({
          error: 'Not Found',
          message: error.message,
        });
      }
      if (error.code === 'CONFLICT') {
        return res.status(409).json({
          error: 'Conflict',
          message: error.message,
        });
      }
      next(error);
    }
  }

  /**
   * DELETE /admin/sekertaris - Demote current Sekertaris
   */
  async demoteSekertaris(req, res, next) {
    try {
      const demotedUser = await adminService.demoteSekertaris();

      res.json({
        message: `${demotedUser.nama} telah diturunkan dari jabatan Sekertaris menjadi warga`,
        data: formatUserResponse(demotedUser),
      });
    } catch (error) {
      if (error.code === 'NOT_FOUND') {
        return res.status(404).json({
          error: 'Not Found',
          message: error.message,
        });
      }
      next(error);
    }
  }

  /**
   * GET /admin/sekertaris/history - Get Sekertaris history
   */
  async getSekertarisHistory(req, res, next) {
    try {
      const profiles = await adminService.getSekertarisHistory();

      res.json({
        message: 'Riwayat Sekertaris berhasil diambil',
        data: profiles.map(formatSekertarisProfileResponse),
      });
    } catch (error) {
      next(error);
    }
  }
}

export default new AdminController();
