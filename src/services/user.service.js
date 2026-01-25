import bcrypt from 'bcrypt';
import prisma from '../config/prisma.js';

/**
 * User Service - Handles user-related business logic
 */
class UserService {
  /**
   * Get user by ID with kependudukan data
   * @param {string} userId - User ID
   * @returns {Promise<object>} User with kependudukan
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
   * Update user profile
   * @param {string} userId - User ID
   * @param {object} data - Update data (nama, noHp, password)
   * @returns {Promise<object>} Updated user
   * @throws {Error} If no data to update
   */
  async updateProfile(userId, { nama, noHp, password }) {
    const updateData = {};

    if (nama !== undefined) {
      updateData.nama = nama;
    }

    if (noHp !== undefined) {
      updateData.noHp = noHp;
    }

    if (password !== undefined) {
      const salt = await bcrypt.genSalt(10);
      updateData.password = await bcrypt.hash(password, salt);
    }

    if (Object.keys(updateData).length === 0) {
      const error = new Error('Tidak ada data yang diupdate');
      error.code = 'BAD_REQUEST';
      throw error;
    }

    const user = await prisma.user.update({
      where: { id: BigInt(userId) },
      data: updateData,
    });

    return user;
  }
}

export default new UserService();
