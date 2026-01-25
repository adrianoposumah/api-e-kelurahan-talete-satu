import { Router } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../config/prisma.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

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
  // Include kependudukan data if user is validated
  kependudukan:
    user.isValidate && user.kependudukan
      ? {
          nik: user.kependudukan.nik,
          nama: user.kependudukan.nama,
          tempat_lahir: user.kependudukan.tempatLahir,
          tanggal_lahir: user.kependudukan.tanggalLahir,
          jenis_kelamin: user.kependudukan.jenisKelamin,
          golongan_darah: user.kependudukan.golonganDarah,
          alamat: user.kependudukan.alamat,
          rt: user.kependudukan.rt,
          rw: user.kependudukan.rw,
          kelurahan: user.kependudukan.kelurahan,
          kecamatan: user.kependudukan.kecamatan,
          kabupaten_kota: user.kependudukan.kabupatenKota,
          provinsi: user.kependudukan.provinsi,
          status_kawin: user.kependudukan.statusKawin,
          agama: user.kependudukan.agama,
          pekerjaan: user.kependudukan.pekerjaan,
          kewarganegaraan: user.kependudukan.kewarganegaraan,
        }
      : undefined,
});

// GET /users/me - Get current user profile (protected)
router.get('/me', authMiddleware, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: BigInt(req.user.userId) },
      include: {
        kependudukan: true,
      },
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
    const { nama, no_hp, password } = req.body;

    // Build update data object with only provided fields
    const updateData = {};
    if (nama !== undefined) updateData.nama = nama;
    if (no_hp !== undefined) updateData.noHp = no_hp;
    if (password !== undefined) {
      const salt = await bcrypt.genSalt(10);
      updateData.password = await bcrypt.hash(password, salt);
    }

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

export default router;
