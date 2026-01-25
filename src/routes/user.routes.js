import { Router } from 'express';
import prisma from '../config/prisma.js';
import { authMiddleware, requireRole } from '../middleware/auth.middleware.js';

const router = Router();

// Helper function to format user response
const formatUserResponse = (user) => ({
  id: user.id.toString(),
  nik: user.nik,
  nama: user.nama,
  no_hp: user.noHp,
  role: user.role,
  is_validate: user.isValidate,
  status: user.status,
  created_at: user.createdAt,
  updated_at: user.updatedAt,
});

// GET /users/me - Get current user profile (protected)
router.get('/me', authMiddleware, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: BigInt(req.user.userId) },
    });

    if (!user) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'User tidak ditemukan',
      });
    }

    res.json(formatUserResponse(user));
  } catch (error) {
    next(error);
  }
});

// PATCH /users/me - Update current user profile (protected)
router.patch('/me', authMiddleware, async (req, res, next) => {
  try {
    const { nama } = req.body;

    // Build update data object with only provided fields
    const updateData = {};
    if (nama !== undefined) updateData.nama = nama;

    // Check if there's anything to update
    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Tidak ada data yang diupdate',
      });
    }

    const user = await prisma.user.update({
      where: { id: BigInt(req.user.userId) },
      data: updateData,
    });

    res.json({
      message: 'Profil berhasil diupdate',
      user: formatUserResponse(user),
    });
  } catch (error) {
    next(error);
  }
});

// GET /users - Get all users (admin only)
router.get('/', authMiddleware, requireRole('admin'), async (req, res, next) => {
  try {
    const { page = 1, limit = 10, status, role } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build filter
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

    res.json({
      data: users.map(formatUserResponse),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        total_pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /users/:id - Get user by ID (admin only)
router.get('/:id', authMiddleware, requireRole('admin'), async (req, res, next) => {
  try {
    const { id } = req.params;

    const user = await prisma.user.findUnique({
      where: { id: BigInt(id) },
    });

    if (!user) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'User tidak ditemukan',
      });
    }

    res.json(formatUserResponse(user));
  } catch (error) {
    next(error);
  }
});

export default router;
