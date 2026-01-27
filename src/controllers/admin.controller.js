import adminService from '../services/admin.service.js';
import { formatUserResponse, formatValidateRequestResponse } from '../utils/formatters.js';

/**
 * Admin Controller - Handles admin request/response
 */
class AdminController {
  /**
   * GET /admin/users - Get all users with pagination
   */
  async getUsers(req, res, next) {
    try {
      const { page, limit, status, role } = req.query;

      const { users, pagination } = await adminService.getUsers({
        page,
        limit,
        status,
        role,
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

      res.json(formatUserResponse(user));
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
      const lurah = await adminService.getCurrentLurah();

      if (!lurah) {
        return res.json({
          message: 'Belum ada Lurah yang ditunjuk',
          data: null,
        });
      }

      res.json({
        message: 'Data Lurah berhasil diambil',
        data: formatUserResponse(lurah),
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
      const { user_id } = req.body;

      if (!user_id) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'user_id wajib diisi',
        });
      }

      const { newLurah, previousLurah } = await adminService.setLurah(user_id);

      res.json({
        message: previousLurah ? `${newLurah.nama} berhasil ditunjuk sebagai Lurah. ${previousLurah.nama} telah diturunkan menjadi warga.` : `${newLurah.nama} berhasil ditunjuk sebagai Lurah`,
        data: {
          new_lurah: formatUserResponse(newLurah),
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
}

export default new AdminController();
