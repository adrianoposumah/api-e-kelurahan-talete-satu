import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import prisma from '../config/prisma.js';
import env from '../config/env.js';

/**
 * Auth Service - Handles authentication business logic
 */
class AuthService {
  /**
   * Generate access and refresh tokens for a user
   * @param {object} user - User object
   * @returns {object} Object containing accessToken and refreshToken
   */
  generateTokens(user) {
    const accessToken = jwt.sign({ userId: user.id.toString(), noHp: user.noHp, role: user.role }, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN });

    const refreshToken = jwt.sign({ userId: user.id.toString(), tokenType: 'refresh' }, env.JWT_REFRESH_SECRET, { expiresIn: env.JWT_REFRESH_EXPIRES_IN });

    return { accessToken, refreshToken };
  }

  /**
   * Calculate refresh token expiry date
   * @returns {Date} Expiry date for refresh token
   */
  getRefreshTokenExpiry() {
    const expiresIn = env.JWT_REFRESH_EXPIRES_IN;
    const match = expiresIn.match(/^(\d+)([dhms])$/);
    if (!match) {
      return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // default 30 days
    }

    const value = parseInt(match[1], 10);
    const unit = match[2];

    const multipliers = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    };

    return new Date(Date.now() + value * multipliers[unit]);
  }

  /**
   * Validate phone number format
   * @param {string} noHp - Phone number to validate
   * @returns {boolean} True if valid
   */
  validatePhoneNumber(noHp) {
    return /^08\d{8,13}$/.test(noHp);
  }

  /**
   * Validate password strength
   * @param {string} password - Password to validate
   * @returns {{valid: boolean, message?: string}} Validation result
   */
  validatePassword(password) {
    if (password.length < 8) {
      return { valid: false, message: 'Password minimal 8 karakter' };
    }

    const hasLetter = /[a-zA-Z]/.test(password);
    const hasNumber = /[0-9]/.test(password);

    if (!hasLetter || !hasNumber) {
      return { valid: false, message: 'Password harus mengandung huruf dan angka' };
    }

    return { valid: true };
  }

  /**
   * Register a new user
   * @param {object} data - Registration data
   * @returns {Promise<object>} Created user
   * @throws {Error} If validation fails or user already exists
   */
  async register({ nama, noHp, password }) {
    // Check if phone number already exists
    const existingUser = await prisma.user.findUnique({ where: { noHp } });
    if (existingUser) {
      const error = new Error('Nomor HP sudah terdaftar');
      error.code = 'CONFLICT';
      throw error;
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = await prisma.user.create({
      data: {
        nama,
        noHp,
        password: hashedPassword,
        role: 'warga',
        isValidate: false,
        status: 'active',
      },
    });

    return user;
  }

  /**
   * Authenticate user with phone number and password
   * @param {object} data - Login credentials
   * @param {object} metadata - Request metadata (userAgent, ipAddress)
   * @returns {Promise<object>} User and tokens
   * @throws {Error} If authentication fails
   */
  async login({ noHp, password }, { userAgent, ipAddress }) {
    const user = await prisma.user.findUnique({ where: { noHp } });
    if (!user) {
      const error = new Error('Login gagal, kredensial tidak valid');
      error.code = 'UNAUTHORIZED';
      throw error;
    }

    if (user.status !== 'active') {
      const error = new Error('Akun tidak aktif atau diblokir');
      error.code = 'UNAUTHORIZED';
      throw error;
    }

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      const error = new Error('Login gagal, kredensial tidak valid');
      error.code = 'UNAUTHORIZED';
      throw error;
    }

    const { accessToken, refreshToken } = this.generateTokens(user);

    // Store refresh token
    await prisma.userToken.create({
      data: {
        userId: user.id,
        refreshToken,
        userAgent,
        ipAddress,
        expiredAt: this.getRefreshTokenExpiry(),
      },
    });

    return { user, accessToken, refreshToken };
  }

  /**
   * Refresh access token using refresh token
   * @param {string} refreshToken - Refresh token
   * @returns {Promise<object>} New access token
   * @throws {Error} If refresh token is invalid
   */
  async refreshToken(refreshToken) {
    // Verify refresh token
    let decoded;
    try {
      decoded = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET);
    } catch {
      const error = new Error('Refresh token invalid atau expired');
      error.code = 'UNAUTHORIZED';
      throw error;
    }

    // Check if refresh token exists in database and not expired
    const storedToken = await prisma.userToken.findFirst({
      where: {
        refreshToken,
        userId: BigInt(decoded.userId),
        expiredAt: { gt: new Date() },
      },
      include: { user: true },
    });

    if (!storedToken) {
      const error = new Error('Refresh token invalid atau expired');
      error.code = 'UNAUTHORIZED';
      throw error;
    }

    // Check if user is still active
    if (storedToken.user.status !== 'active') {
      const error = new Error('Akun tidak aktif atau diblokir');
      error.code = 'UNAUTHORIZED';
      throw error;
    }

    // Generate new access token
    const accessToken = jwt.sign(
      {
        userId: storedToken.user.id.toString(),
        noHp: storedToken.user.noHp,
        role: storedToken.user.role,
      },
      env.JWT_SECRET,
      { expiresIn: env.JWT_EXPIRES_IN },
    );

    return { accessToken };
  }

  /**
   * Logout user by revoking refresh token
   * @param {string} refreshToken - Refresh token to revoke
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} True if token was revoked
   * @throws {Error} If token not found
   */
  async logout(refreshToken, userId) {
    const deleted = await prisma.userToken.deleteMany({
      where: {
        refreshToken,
        userId: BigInt(userId),
      },
    });

    if (deleted.count === 0) {
      const error = new Error('Refresh token tidak ditemukan');
      error.code = 'BAD_REQUEST';
      throw error;
    }

    return true;
  }

  /**
   * Save FCM token for a user session
   * @param {string} userId - User ID
   * @param {string} fcmToken - FCM token from client
   * @returns {Promise<boolean>}
   */
  async saveFcmToken(userId, fcmToken) {
    const latestSession = await prisma.userToken.findFirst({
      where: { userId: BigInt(userId) },
      orderBy: { createdAt: 'desc' }
    });

    if (!latestSession) {
      const error = new Error('Sesi pengguna tidak ditemukan');
      error.code = 'NOT_FOUND';
      throw error;
    }

    await prisma.userToken.update({
      where: { id: latestSession.id },
      data: { fcmToken }
    });

    return true;
  }
}

export default new AuthService();
