import { Router } from 'express';
import prisma from '../config/prisma.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

const router = Router();

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
  // Include related data if available
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

// POST /validate-requests - Create a validation request (authenticated users)
router.post('/', authMiddleware, async (req, res, next) => {
  try {
    const { nik } = req.body;
    const userId = BigInt(req.user.userId);

    // Validate NIK format
    if (!nik || !/^\d{16}$/.test(nik)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'NIK harus 16 digit angka',
      });
    }

    // Check if user is already validated
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (user.isValidate) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Akun anda sudah tervalidasi',
      });
    }

    // Check if NIK exists in data_kependudukan
    const kependudukan = await prisma.dataKependudukan.findUnique({
      where: { nik },
    });

    if (!kependudukan) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'NIK tidak ditemukan dalam data kependudukan',
      });
    }

    // Check if NIK is already used by another user
    const existingUserWithNik = await prisma.user.findUnique({
      where: { nik },
    });

    if (existingUserWithNik && existingUserWithNik.id !== userId) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'NIK sudah digunakan oleh pengguna lain',
      });
    }

    // Check if there's already a pending request for this user
    const existingRequest = await prisma.validateRequest.findFirst({
      where: {
        userId,
        status: 'pending',
      },
    });

    if (existingRequest) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'Anda sudah memiliki permintaan validasi yang sedang diproses',
      });
    }

    // Create validation request
    const validateRequest = await prisma.validateRequest.create({
      data: {
        userId,
        nik,
      },
      include: {
        user: true,
        kependudukan: true,
      },
    });

    res.status(201).json({
      message: 'Permintaan validasi berhasil dibuat',
      data: formatValidateRequestResponse(validateRequest),
    });
  } catch (error) {
    next(error);
  }
});

// GET /validate-requests/me - Get current user's validation requests
router.get('/me', authMiddleware, async (req, res, next) => {
  try {
    const userId = BigInt(req.user.userId);

    const requests = await prisma.validateRequest.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        kependudukan: true,
        admin: true,
      },
    });

    res.json({
      data: requests.map(formatValidateRequestResponse),
    });
  } catch (error) {
    next(error);
  }
});

export default router;
