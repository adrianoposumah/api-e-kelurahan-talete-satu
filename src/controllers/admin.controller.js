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
}

export default new AdminController();
