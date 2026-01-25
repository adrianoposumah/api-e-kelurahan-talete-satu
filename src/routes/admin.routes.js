import { Router } from 'express';
import prisma from '../config/prisma.js';
import { authMiddleware, requireRole } from '../middleware/auth.middleware.js';

const router = Router();

// Apply admin middleware to all routes
router.use(authMiddleware, requireRole('admin'));

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

// Helper function to format validate request response
const formatValidateRequestResponse = (request) => ({
  id: request.id.toString(),
  user_id: request.userId.toString(),
  nik: request.nik,
  status: request.status,
  admin_notes: request.adminNotes,
  processed_by: request.processedBy?.toString() || null,
  processed_at: request.processedAt,
  created_at: request.createdAt,
  updated_at: request.updatedAt,
  user: request.user
    ? {
        id: request.user.id.toString(),
        nama: request.user.nama,
        no_hp: request.user.noHp,
      }
    : undefined,
  kependudukan: request.kependudukan
    ? {
        nik: request.kependudukan.nik,
        nama: request.kependudukan.nama,
        tempat_lahir: request.kependudukan.tempatLahir,
        tanggal_lahir: request.kependudukan.tanggalLahir,
        jenis_kelamin: request.kependudukan.jenisKelamin,
        golongan_darah: request.kependudukan.golonganDarah,
        alamat: request.kependudukan.alamat,
        rt: request.kependudukan.rt,
        rw: request.kependudukan.rw,
        kelurahan: request.kependudukan.kelurahan,
        kecamatan: request.kependudukan.kecamatan,
        kabupaten_kota: request.kependudukan.kabupatenKota,
        provinsi: request.kependudukan.provinsi,
        status_kawin: request.kependudukan.statusKawin,
        agama: request.kependudukan.agama,
        pekerjaan: request.kependudukan.pekerjaan,
        kewarganegaraan: request.kependudukan.kewarganegaraan,
      }
    : undefined,
  admin: request.admin
    ? {
        id: request.admin.id.toString(),
        nama: request.admin.nama,
      }
    : undefined,
});

// ==================== USER MANAGEMENT ====================

// GET /admin/users - Get all users with pagination
router.get('/users', async (req, res, next) => {
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

// GET /admin/users/:id - Get user by ID
router.get('/users/:id', async (req, res, next) => {
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

// ==================== VALIDATE REQUESTS ====================

// GET /admin/validate-requests - Get all validation requests with pagination
router.get('/validate-requests', async (req, res, next) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build filter
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

    res.json({
      data: requests.map(formatValidateRequestResponse),
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

// GET /admin/validate-requests/:id - Get validation request by ID
router.get('/validate-requests/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const request = await prisma.validateRequest.findUnique({
      where: { id: BigInt(id) },
      include: {
        user: true,
        kependudukan: true,
        admin: true,
      },
    });

    if (!request) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Permintaan validasi tidak ditemukan',
      });
    }

    res.json(formatValidateRequestResponse(request));
  } catch (error) {
    next(error);
  }
});

// PATCH /admin/validate-requests/:id - Process validation request
router.patch('/validate-requests/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, admin_notes } = req.body;
    const adminId = BigInt(req.user.userId);

    // Validate status
    if (!status || !['approved', 'rejected'].includes(status)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Status harus "approved" atau "rejected"',
      });
    }

    // Find the request
    const existingRequest = await prisma.validateRequest.findUnique({
      where: { id: BigInt(id) },
    });

    if (!existingRequest) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Permintaan validasi tidak ditemukan',
      });
    }

    if (existingRequest.status !== 'pending') {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Permintaan validasi ini sudah diproses',
      });
    }

    // Use transaction to update both request and user (if approved)
    const result = await prisma.$transaction(async (tx) => {
      // Update the validation request
      const updatedRequest = await tx.validateRequest.update({
        where: { id: BigInt(id) },
        data: {
          status,
          adminNotes: admin_notes,
          processedBy: adminId,
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

    res.json({
      message: status === 'approved' ? 'Permintaan validasi berhasil disetujui' : 'Permintaan validasi ditolak',
      data: formatValidateRequestResponse(result),
    });
  } catch (error) {
    next(error);
  }
});

export default router;
