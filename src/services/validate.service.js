import prisma from '../config/prisma.js';

/**
 * Validate Service - Handles validation request business logic
 */
class ValidateService {
  /**
   * Validate NIK format
   * @param {string} nik - NIK to validate
   * @returns {boolean} True if valid
   */
  validateNikFormat(nik) {
    return nik && /^\d{16}$/.test(nik);
  }

  /**
   * Create a validation request
   * @param {string} userId - User ID
   * @param {string} nik - NIK to validate
   * @returns {Promise<object>} Created validation request
   * @throws {Error} If validation fails
   */
  async createValidateRequest(userId, nik) {
    const userIdBigInt = BigInt(userId);

    // Check if user is already validated
    const user = await prisma.user.findUnique({
      where: { id: userIdBigInt },
    });

    if (user.isValidate) {
      const error = new Error('Akun anda sudah tervalidasi');
      error.code = 'BAD_REQUEST';
      throw error;
    }

    // Check if NIK exists in data_kependudukan
    const kependudukan = await prisma.dataKependudukan.findUnique({
      where: { nik },
    });

    if (!kependudukan) {
      const error = new Error('NIK tidak ditemukan dalam data kependudukan');
      error.code = 'NOT_FOUND';
      throw error;
    }

    // Check if NIK is already used by another user
    const existingUserWithNik = await prisma.user.findUnique({
      where: { nik },
    });

    if (existingUserWithNik && existingUserWithNik.id !== userIdBigInt) {
      const error = new Error('NIK sudah digunakan oleh pengguna lain');
      error.code = 'CONFLICT';
      throw error;
    }

    // Check if there's already a pending request for this user
    const existingRequest = await prisma.validateRequest.findFirst({
      where: {
        userId: userIdBigInt,
        status: 'pending',
      },
    });

    if (existingRequest) {
      const error = new Error('Anda sudah memiliki permintaan validasi yang sedang diproses');
      error.code = 'CONFLICT';
      throw error;
    }

    // Create validation request
    const validateRequest = await prisma.validateRequest.create({
      data: {
        userId: userIdBigInt,
        nik,
      },
      include: {
        user: true,
        kependudukan: true,
      },
    });

    return validateRequest;
  }

  /**
   * Get validation requests for a user
   * @param {string} userId - User ID
   * @returns {Promise<array>} List of validation requests
   */
  async getUserValidateRequests(userId) {
    const requests = await prisma.validateRequest.findMany({
      where: { userId: BigInt(userId) },
      orderBy: { createdAt: 'desc' },
      include: {
        kependudukan: true,
        admin: true,
      },
    });

    return requests;
  }
}

export default new ValidateService();
