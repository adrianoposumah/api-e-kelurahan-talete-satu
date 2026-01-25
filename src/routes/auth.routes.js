import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import prisma from '../config/prisma.js';
import env from '../config/env.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

const router = Router();

// Helper function to generate tokens
const generateTokens = (user) => {
  const accessToken = jwt.sign({ userId: user.id.toString(), noHp: user.noHp, role: user.role }, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN });

  const refreshToken = jwt.sign({ userId: user.id.toString(), tokenType: 'refresh' }, env.JWT_REFRESH_SECRET, { expiresIn: env.JWT_REFRESH_EXPIRES_IN });

  return { accessToken, refreshToken };
};

// Helper function to parse JWT expiration to Date
const getRefreshTokenExpiry = () => {
  const expiresIn = env.JWT_REFRESH_EXPIRES_IN;
  const match = expiresIn.match(/^(\d+)([dhms])$/);
  if (!match) {
    return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // default 7 days
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
};

// Helper function to format user response (exclude password)
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

// POST /auth/register - Register new user
router.post('/register', async (req, res, next) => {
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
    if (!/^08\d{8,13}$/.test(no_hp)) {
      return res.status(400).json({
        error: 'Data tidak valid',
        message: 'Format nomor HP tidak valid',
      });
    }

    // Validate password strength (minimum 8 characters, must contain letters and numbers)
    if (password.length < 8) {
      return res.status(400).json({
        error: 'Data tidak valid',
        message: 'Password minimal 8 karakter',
      });
    }

    // Check if password contains at least one letter and one number
    const hasLetter = /[a-zA-Z]/.test(password);
    const hasNumber = /[0-9]/.test(password);

    if (!hasLetter || !hasNumber) {
      return res.status(400).json({
        error: 'Data tidak valid',
        message: 'Password harus mengandung huruf dan angka',
      });
    }

    // Check if phone number already exists
    const existingUser = await prisma.user.findUnique({ where: { noHp: no_hp } });
    if (existingUser) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'Nomor HP sudah terdaftar',
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = await prisma.user.create({
      data: {
        nama,
        noHp: no_hp,
        password: hashedPassword,
        role: 'warga',
        isValidate: false,
        status: 'active',
      },
    });

    res.status(201).json({
      message: 'User berhasil dibuat',
      user: formatUserResponse(user),
    });
  } catch (error) {
    next(error);
  }
});

// POST /auth/login - Login with no_hp and password
router.post('/login', async (req, res, next) => {
  try {
    const { no_hp, password } = req.body;

    if (!no_hp || !password) {
      return res.status(400).json({
        error: 'Data tidak valid',
        message: 'No HP dan password wajib diisi',
      });
    }

    const user = await prisma.user.findUnique({ where: { noHp: no_hp } });
    if (!user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Login gagal, kredensial tidak valid',
      });
    }

    if (user.status !== 'active') {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Akun tidak aktif atau diblokir',
      });
    }

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Login gagal, kredensial tidak valid',
      });
    }

    const { accessToken, refreshToken } = generateTokens(user);

    await prisma.userToken.create({
      data: {
        userId: user.id,
        refreshToken,
        userAgent: req.headers['user-agent'] || null,
        ipAddress: req.ip || req.connection?.remoteAddress || null,
        expiredAt: getRefreshTokenExpiry(),
      },
    });

    res.json({
      message: 'Login sukses',
      access_token: accessToken,
      refresh_token: refreshToken,
      user: formatUserResponse(user),
    });
  } catch (error) {
    next(error);
  }
});

// POST /auth/refresh - Refresh access token
router.post('/refresh', async (req, res, next) => {
  try {
    const { refresh_token } = req.body;

    if (!refresh_token) {
      return res.status(400).json({
        error: 'Data tidak valid',
        message: 'Refresh token wajib diisi',
      });
    }

    // Verify refresh token
    let decoded;
    try {
      decoded = jwt.verify(refresh_token, env.JWT_REFRESH_SECRET);
    } catch {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Refresh token invalid atau expired',
      });
    }

    // Check if refresh token exists in database and not expired
    const storedToken = await prisma.userToken.findFirst({
      where: {
        refreshToken: refresh_token,
        userId: BigInt(decoded.userId),
        expiredAt: { gt: new Date() },
      },
      include: { user: true },
    });

    if (!storedToken) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Refresh token invalid atau expired',
      });
    }

    // Check if user is still active
    if (storedToken.user.status !== 'active') {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Akun tidak aktif atau diblokir',
      });
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

    res.json({
      message: 'Access token diperbarui',
      access_token: accessToken,
    });
  } catch (error) {
    next(error);
  }
});

// POST /auth/logout - Logout and revoke refresh token
router.post('/logout', authMiddleware, async (req, res, next) => {
  try {
    const { refresh_token } = req.body;

    if (!refresh_token) {
      return res.status(400).json({
        error: 'Data tidak valid',
        message: 'Refresh token wajib diisi',
      });
    }

    // Delete the refresh token from database
    const deleted = await prisma.userToken.deleteMany({
      where: {
        refreshToken: refresh_token,
        userId: BigInt(req.user.userId),
      },
    });

    if (deleted.count === 0) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Refresh token tidak ditemukan',
      });
    }

    res.json({ message: 'Logout sukses' });
  } catch (error) {
    next(error);
  }
});

export default router;
