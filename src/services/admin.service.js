import prisma from '../config/prisma.js';

/**
 * Admin Service - Handles admin-related business logic
 */
class AdminService {
  /**
   * Get all users with pagination and filters
   * @param {object} options - Query options
   * @returns {Promise<object>} Users and pagination info
   */
  async getUsers({ page = 1, limit = 10, status, role }) {
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (status) where.status = status;
    if (role) where.role = role;

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
    });

    if (!user) {
      const error = new Error('User tidak ditemukan');
      error.code = 'NOT_FOUND';
      throw error;
    }

    return user;
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

    // Use transaction to update both request and user (if approved)
    const result = await prisma.$transaction(async (tx) => {
      // Update the validation request
      const updatedRequest = await tx.validateRequest.update({
        where: { id: BigInt(requestId) },
        data: {
          status,
          adminNotes,
          processedBy: BigInt(adminId),
          processedAt: new Date(),
        },
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
            nik: existingRequest.nik,
            isValidate: true,
          },
        });
      }

      return updatedRequest;
    });

    return result;
  }

  // ==================== LURAH MANAGEMENT ====================

  /**
   * Get current Lurah
   * @returns {Promise<object|null>} Current Lurah user or null
   */
  async getCurrentLurah() {
    const lurah = await prisma.user.findFirst({
      where: { role: 'lurah' },
      include: { kependudukan: true },
    });

    return lurah;
  }

  /**
   * Set a user as Lurah (only one Lurah allowed)
   * @param {string} userId - User ID to promote to Lurah
   * @returns {Promise<object>} Updated user
   * @throws {Error} If user not found or validation fails
   */
  async setLurah(userId) {
    // Find the user to promote
    const user = await prisma.user.findUnique({
      where: { id: BigInt(userId) },
      include: { kependudukan: true },
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

    if (!user.isValidate) {
      const error = new Error('User harus tervalidasi terlebih dahulu');
      error.code = 'BAD_REQUEST';
      throw error;
    }

    // Use transaction to demote current Lurah and promote new one
    const result = await prisma.$transaction(async (tx) => {
      // Find and demote current Lurah (if exists)
      const currentLurah = await tx.user.findFirst({
        where: { role: 'lurah' },
      });

      if (currentLurah) {
        await tx.user.update({
          where: { id: currentLurah.id },
          data: { role: 'warga' },
        });
      }

      // Promote new user to Lurah
      const newLurah = await tx.user.update({
        where: { id: BigInt(userId) },
        data: { role: 'lurah' },
        include: { kependudukan: true },
      });

      return { newLurah, previousLurah: currentLurah };
    });

    return result;
  }

  /**
   * Demote current Lurah to warga
   * @returns {Promise<object>} Demoted user
   * @throws {Error} If no Lurah exists
   */
  async demoteLurah() {
    const currentLurah = await prisma.user.findFirst({
      where: { role: 'lurah' },
    });

    if (!currentLurah) {
      const error = new Error('Tidak ada Lurah yang aktif');
      error.code = 'NOT_FOUND';
      throw error;
    }

    const demotedUser = await prisma.user.update({
      where: { id: currentLurah.id },
      data: { role: 'warga' },
      include: { kependudukan: true },
    });

    return demotedUser;
  }
}

export default new AdminService();
