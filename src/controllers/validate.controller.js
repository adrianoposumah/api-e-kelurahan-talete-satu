import validateService from '../services/validate.service.js';
import { formatValidateRequestResponse } from '../utils/formatters.js';

/**
 * Validate Controller - Handles validation request/response
 */
class ValidateController {
  /**
   * POST /validate-requests - Create a validation request
   */
  async create(req, res, next) {
    try {
      const { nik } = req.body;

      // Validate NIK format
      if (!validateService.validateNikFormat(nik)) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'NIK harus 16 digit angka',
        });
      }

      const validateRequest = await validateService.createValidateRequest(req.user.userId, nik);

      res.status(201).json({
        message: 'Permintaan validasi berhasil dibuat',
        data: formatValidateRequestResponse(validateRequest),
      });
    } catch (error) {
      if (error.code === 'BAD_REQUEST') {
        return res.status(400).json({
          error: 'Bad Request',
          message: error.message,
        });
      }
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
   * GET /validate-requests/me - Get current user's validation requests
   */
  async getMyRequests(req, res, next) {
    try {
      const requests = await validateService.getUserValidateRequests(req.user.userId);

      res.json({
        data: requests.map(formatValidateRequestResponse),
      });
    } catch (error) {
      next(error);
    }
  }
}

export default new ValidateController();
