import userService from '../services/user.service.js';
import { formatUserResponse, formatUserWithKependudukanResponse } from '../utils/formatters.js';

/**
 * User Controller - Handles user request/response
 */
class UserController {
  /**
   * GET /users/me - Get current user profile
   */
  async getProfile(req, res, next) {
    try {
      const user = await userService.getUserById(req.user.userId);

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
   * PATCH /users/me - Update current user profile
   */
  async updateProfile(req, res, next) {
    try {
      const { nama, no_hp, password } = req.body;

      const user = await userService.updateProfile(req.user.userId, {
        nama,
        noHp: no_hp,
        password,
      });

      res.json({
        message: 'Profil berhasil diupdate',
        user: formatUserResponse(user),
      });
    } catch (error) {
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

export default new UserController();
