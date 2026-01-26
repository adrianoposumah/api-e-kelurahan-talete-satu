import prisma from '../config/prisma.js';

/**
 * Lingkungan Service - Handles lingkungan and kepling assignment business logic
 */
class LingkunganService {
  /**
   * Get all lingkungan with pagination
   * @param {object} options - Query options
   * @returns {Promise<object>} Lingkungan list and pagination info
   */
  async getAllLingkungan({ page = 1, limit = 10 }) {
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [lingkungan, total] = await Promise.all([
      prisma.lingkungan.findMany({
        skip,
        take: parseInt(limit),
        orderBy: { id: 'asc' },
        include: {
          keplings: {
            where: {
              OR: [{ selesai: null }, { selesai: { gt: new Date() } }],
            },
            include: {
              user: {
                select: {
                  id: true,
                  nama: true,
                  noHp: true,
                  nik: true,
                },
              },
            },
          },
        },
      }),
      prisma.lingkungan.count(),
    ]);

    return {
      lingkungan,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        total_pages: Math.ceil(total / parseInt(limit)),
      },
    };
  }

  /**
   * Get lingkungan by ID
   * @param {string} lingkunganId - Lingkungan ID
   * @returns {Promise<object>} Lingkungan
   * @throws {Error} If lingkungan not found
   */
  async getLingkunganById(lingkunganId) {
    const lingkungan = await prisma.lingkungan.findUnique({
      where: { id: BigInt(lingkunganId) },
      include: {
        keplings: {
          include: {
            user: {
              select: {
                id: true,
                nama: true,
                noHp: true,
                nik: true,
              },
            },
          },
          orderBy: { mulai: 'desc' },
        },
      },
    });

    if (!lingkungan) {
      const error = new Error('Lingkungan tidak ditemukan');
      error.code = 'NOT_FOUND';
      throw error;
    }

    return lingkungan;
  }

  /**
   * Create new lingkungan
   * @param {object} data - Lingkungan data
   * @returns {Promise<object>} Created lingkungan
   */
  async createLingkungan({ nama, kode }) {
    // Check if kode already exists
    if (kode) {
      const existing = await prisma.lingkungan.findUnique({
        where: { kode },
      });

      if (existing) {
        const error = new Error('Kode lingkungan sudah digunakan');
        error.code = 'CONFLICT';
        throw error;
      }
    }

    const lingkungan = await prisma.lingkungan.create({
      data: { nama, kode },
    });

    return lingkungan;
  }

  /**
   * Update lingkungan
   * @param {string} lingkunganId - Lingkungan ID
   * @param {object} data - Update data
   * @returns {Promise<object>} Updated lingkungan
   */
  async updateLingkungan(lingkunganId, { nama, kode }) {
    const existing = await prisma.lingkungan.findUnique({
      where: { id: BigInt(lingkunganId) },
    });

    if (!existing) {
      const error = new Error('Lingkungan tidak ditemukan');
      error.code = 'NOT_FOUND';
      throw error;
    }

    // Check if new kode conflicts with another lingkungan
    if (kode && kode !== existing.kode) {
      const conflict = await prisma.lingkungan.findUnique({
        where: { kode },
      });

      if (conflict) {
        const error = new Error('Kode lingkungan sudah digunakan');
        error.code = 'CONFLICT';
        throw error;
      }
    }

    const lingkungan = await prisma.lingkungan.update({
      where: { id: BigInt(lingkunganId) },
      data: { nama, kode },
    });

    return lingkungan;
  }

  /**
   * Delete lingkungan
   * @param {string} lingkunganId - Lingkungan ID
   * @returns {Promise<void>}
   */
  async deleteLingkungan(lingkunganId) {
    const existing = await prisma.lingkungan.findUnique({
      where: { id: BigInt(lingkunganId) },
      include: {
        keplings: {
          where: {
            OR: [{ selesai: null }, { selesai: { gt: new Date() } }],
          },
        },
      },
    });

    if (!existing) {
      const error = new Error('Lingkungan tidak ditemukan');
      error.code = 'NOT_FOUND';
      throw error;
    }

    // Check if there are active kepling assignments
    if (existing.keplings.length > 0) {
      const error = new Error('Tidak dapat menghapus lingkungan yang masih memiliki kepling aktif');
      error.code = 'BAD_REQUEST';
      throw error;
    }

    await prisma.lingkungan.delete({
      where: { id: BigInt(lingkunganId) },
    });
  }

  /**
   * Assign a user as kepling to a lingkungan
   * @param {object} data - Assignment data
   * @returns {Promise<object>} Created assignment
   */
  async assignKepling({ lingkunganId, userId, mulai, selesai }) {
    // Verify lingkungan exists
    const lingkungan = await prisma.lingkungan.findUnique({
      where: { id: BigInt(lingkunganId) },
    });

    if (!lingkungan) {
      const error = new Error('Lingkungan tidak ditemukan');
      error.code = 'NOT_FOUND';
      throw error;
    }

    // Verify user exists
    const user = await prisma.user.findUnique({
      where: { id: BigInt(userId) },
    });

    if (!user) {
      const error = new Error('User tidak ditemukan');
      error.code = 'NOT_FOUND';
      throw error;
    }

    // Check if user is already an active kepling in any lingkungan
    const existingAssignment = await prisma.lingkunganKepling.findFirst({
      where: {
        userId: BigInt(userId),
        OR: [{ selesai: null }, { selesai: { gt: new Date() } }],
      },
    });

    if (existingAssignment) {
      const error = new Error('User sudah menjadi kepling aktif di lingkungan lain');
      error.code = 'CONFLICT';
      throw error;
    }

    // Check if lingkungan already has an active kepling
    const existingKepling = await prisma.lingkunganKepling.findFirst({
      where: {
        lingkunganId: BigInt(lingkunganId),
        OR: [{ selesai: null }, { selesai: { gt: new Date() } }],
      },
    });

    if (existingKepling) {
      const error = new Error('Lingkungan ini sudah memiliki kepling aktif');
      error.code = 'CONFLICT';
      throw error;
    }

    // Use transaction to create assignment and update user role
    const result = await prisma.$transaction(async (tx) => {
      // Create the assignment
      const assignment = await tx.lingkunganKepling.create({
        data: {
          lingkunganId: BigInt(lingkunganId),
          userId: BigInt(userId),
          mulai: new Date(mulai),
          selesai: selesai ? new Date(selesai) : null,
        },
        include: {
          lingkungan: true,
          user: {
            select: {
              id: true,
              nama: true,
              noHp: true,
              nik: true,
              role: true,
            },
          },
        },
      });

      // Update user role to kepling
      await tx.user.update({
        where: { id: BigInt(userId) },
        data: { role: 'kepling' },
      });

      return assignment;
    });

    return result;
  }

  /**
   * End kepling assignment (remove kepling from lingkungan)
   * @param {string} assignmentId - Assignment ID
   * @param {Date} selesai - End date (defaults to now)
   * @returns {Promise<object>} Updated assignment
   */
  async endKeplingAssignment(assignmentId, selesai = new Date()) {
    const assignment = await prisma.lingkunganKepling.findUnique({
      where: { id: BigInt(assignmentId) },
    });

    if (!assignment) {
      const error = new Error('Penugasan kepling tidak ditemukan');
      error.code = 'NOT_FOUND';
      throw error;
    }

    if (assignment.selesai && assignment.selesai < new Date()) {
      const error = new Error('Penugasan kepling ini sudah berakhir');
      error.code = 'BAD_REQUEST';
      throw error;
    }

    // Use transaction to update assignment and user role
    const result = await prisma.$transaction(async (tx) => {
      // Update the assignment with end date
      const updatedAssignment = await tx.lingkunganKepling.update({
        where: { id: BigInt(assignmentId) },
        data: { selesai: new Date(selesai) },
        include: {
          lingkungan: true,
          user: {
            select: {
              id: true,
              nama: true,
              noHp: true,
              nik: true,
              role: true,
            },
          },
        },
      });

      // Check if user has any other active kepling assignments
      const otherActiveAssignments = await tx.lingkunganKepling.findFirst({
        where: {
          userId: assignment.userId,
          id: { not: BigInt(assignmentId) },
          OR: [{ selesai: null }, { selesai: { gt: new Date() } }],
        },
      });

      // If no other active assignments, revert user role to warga
      if (!otherActiveAssignments) {
        await tx.user.update({
          where: { id: assignment.userId },
          data: { role: 'warga' },
        });
      }

      return updatedAssignment;
    });

    return result;
  }

  /**
   * Get kepling assignment history for a user
   * @param {string} userId - User ID
   * @returns {Promise<Array>} Assignment history
   */
  async getKeplingHistoryByUser(userId) {
    const assignments = await prisma.lingkunganKepling.findMany({
      where: { userId: BigInt(userId) },
      include: {
        lingkungan: true,
      },
      orderBy: { mulai: 'desc' },
    });

    return assignments;
  }

  /**
   * Get all kepling assignments with pagination
   * @param {object} options - Query options
   * @returns {Promise<object>} Assignments and pagination info
   */
  async getAllKeplingAssignments({ page = 1, limit = 10, activeOnly = false }) {
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = activeOnly ? { OR: [{ selesai: null }, { selesai: { gt: new Date() } }] } : {};

    const [assignments, total] = await Promise.all([
      prisma.lingkunganKepling.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { mulai: 'desc' },
        include: {
          lingkungan: true,
          user: {
            select: {
              id: true,
              nama: true,
              noHp: true,
              nik: true,
              role: true,
            },
          },
        },
      }),
      prisma.lingkunganKepling.count({ where }),
    ]);

    return {
      assignments,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        total_pages: Math.ceil(total / parseInt(limit)),
      },
    };
  }

  /**
   * Get all active kepling users with their assigned lingkungan
   * @param {object} options - Query options
   * @returns {Promise<object>} Active keplings and pagination info
   */
  async getActiveKeplings({ page = 1, limit = 10 }) {
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {
      OR: [{ selesai: null }, { selesai: { gt: new Date() } }],
    };

    const [assignments, total] = await Promise.all([
      prisma.lingkunganKepling.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { mulai: 'desc' },
        include: {
          lingkungan: true,
          user: {
            select: {
              id: true,
              nama: true,
              noHp: true,
              nik: true,
              role: true,
            },
          },
        },
      }),
      prisma.lingkunganKepling.count({ where }),
    ]);

    return {
      keplings: assignments,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        total_pages: Math.ceil(total / parseInt(limit)),
      },
    };
  }
}

export default new LingkunganService();
