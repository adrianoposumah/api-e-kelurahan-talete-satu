import authService from '../services/auth.service.js';
import { formatUserResponse } from '../utils/formatters.js';

/**
 * Auth Controller - Handles authentication request/response
 */
class AuthController {
  /**
   * POST /auth/register - Register new user
   */
  async register(req, res, next) {
    try {
      const { nama, no_hp, password } = req.body;

      // Validate required fields
      if (!nama || !no_hp || !password) {
        return res.status(400).json({
          error: 'Data tidak valid',
          message: 'Nama, no_hp, dan password wajib diisi',
        });
      }

      // Validate phone number format
      if (!authService.validatePhoneNumber(no_hp)) {
        return res.status(400).json({
          error: 'Data tidak valid',
          message: 'Format nomor HP tidak valid',
        });
      }

      // Validate password strength
      const passwordValidation = authService.validatePassword(password);
      if (!passwordValidation.valid) {
        return res.status(400).json({
          error: 'Data tidak valid',
          message: passwordValidation.message,
        });
      }

      const user = await authService.register({
        nama,
        noHp: no_hp,
        password,
      });

      res.status(201).json({
        message: 'User berhasil dibuat',
        user: formatUserResponse(user),
      });
    } catch (error) {
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
   * POST /auth/login - Login with no_hp and password
   */
  async login(req, res, next) {
    try {
      const { no_hp, password } = req.body;

      if (!no_hp || !password) {
        return res.status(400).json({
          error: 'Data tidak valid',
          message: 'No HP dan password wajib diisi',
        });
      }

      const { user, accessToken, refreshToken } = await authService.login(
        { noHp: no_hp, password },
        {
          userAgent: req.headers['user-agent'] || null,
          ipAddress: req.ip || req.connection?.remoteAddress || null,
        },
      );

      res.json({
        message: 'Login sukses',
        access_token: accessToken,
        refresh_token: refreshToken,
        user: formatUserResponse(user),
      });
    } catch (error) {
      if (error.code === 'UNAUTHORIZED') {
        return res.status(401).json({
          error: 'Unauthorized',
          message: error.message,
        });
      }
      next(error);
    }
  }

  /**
   * POST /auth/refresh - Refresh access token
   */
  async refresh(req, res, next) {
    try {
      const { refresh_token } = req.body;

      if (!refresh_token) {
        return res.status(400).json({
          error: 'Data tidak valid',
          message: 'Refresh token wajib diisi',
        });
      }

      const { accessToken } = await authService.refreshToken(refresh_token);

      res.json({
        message: 'Access token diperbarui',
        access_token: accessToken,
      });
    } catch (error) {
      if (error.code === 'UNAUTHORIZED') {
        return res.status(401).json({
          error: 'Unauthorized',
          message: error.message,
        });
      }
      next(error);
    }
  }

  /**
   * POST /auth/logout - Logout and revoke refresh token
   */
  async logout(req, res, next) {
    try {
      const { refresh_token } = req.body;

      if (!refresh_token) {
        return res.status(400).json({
          error: 'Data tidak valid',
          message: 'Refresh token wajib diisi',
        });
      }

      await authService.logout(refresh_token, req.user.userId);

      res.json({ message: 'Logout sukses' });
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

export default new AuthController();
