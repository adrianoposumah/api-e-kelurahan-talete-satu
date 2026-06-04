import { existsSync, rmSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

import prisma from '../config/prisma.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..', '..');

const notFound = (message) => {
  const error = new Error(message);
  error.code = 'NOT_FOUND';
  return error;
};

const toDateOrNull = (value) => {
  if (value === undefined || value === null || String(value).trim() === '') {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const removeFileIfExists = (relativePath) => {
  if (!relativePath) {
    return;
  }

  const absolutePath = resolve(PROJECT_ROOT, relativePath);
  if (existsSync(absolutePath)) {
    rmSync(absolutePath, { force: true });
  }
};

/**
 * Arsip Surat service - standalone management of external/manual incoming and
 * outgoing letters (surat masuk / surat keluar). The unified log additionally
 * reads IssuedLetter at query time without duplicating system-generated letters.
 */
class ArsipService {
  buildArsipWhere({ direction, search, startDate, endDate }) {
    const where = {};

    if (direction === 'masuk' || direction === 'keluar') {
      where.direction = direction;
    }

    const tanggalSurat = {};
    const start = toDateOrNull(startDate);
    const end = toDateOrNull(endDate);
    if (start) tanggalSurat.gte = start;
    if (end) tanggalSurat.lte = end;
    if (Object.keys(tanggalSurat).length > 0) {
      where.tanggalSurat = tanggalSurat;
    }

    if (search && String(search).trim() !== '') {
      const term = String(search).trim();
      where.OR = [{ nomorSurat: { contains: term, mode: 'insensitive' } }, { pihak: { contains: term, mode: 'insensitive' } }, { perihal: { contains: term, mode: 'insensitive' } }];
    }

    return where;
  }

  async createArsip({ direction, nomorSurat, tanggalSurat, tanggalDiterima, pihak, perihal, sifat, keterangan, file, userId }) {
    const user = await prisma.user.findUnique({ where: { id: BigInt(userId) } });
    if (!user) {
      throw notFound('User tidak ditemukan');
    }

    return prisma.arsipSurat.create({
      data: {
        direction,
        nomorSurat,
        tanggalSurat: new Date(tanggalSurat),
        tanggalDiterima: direction === 'masuk' ? toDateOrNull(tanggalDiterima) : null,
        pihak,
        perihal,
        sifat: sifat || 'biasa',
        keterangan: keterangan || null,
        filePath: file?.path || null,
        fileType: file?.mimetype || null,
        createdById: BigInt(userId),
      },
      include: { createdBy: { select: { id: true, nama: true } } },
    });
  }

  async listArsip({ direction, search, startDate, endDate, page = 1, limit = 50 }) {
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const where = this.buildArsipWhere({ direction, search, startDate, endDate });

    const [items, total] = await Promise.all([
      prisma.arsipSurat.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { tanggalSurat: 'desc' },
        include: { createdBy: { select: { id: true, nama: true } } },
      }),
      prisma.arsipSurat.count({ where }),
    ]);

    return {
      items,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        total_pages: Math.ceil(total / parseInt(limit)),
      },
    };
  }

  async getArsipById(id) {
    const arsip = await prisma.arsipSurat.findUnique({
      where: { id: BigInt(id) },
      include: { createdBy: { select: { id: true, nama: true } } },
    });

    if (!arsip) {
      throw notFound('Arsip surat tidak ditemukan');
    }

    return arsip;
  }

  async updateArsip(id, { direction, nomorSurat, tanggalSurat, tanggalDiterima, pihak, perihal, sifat, keterangan, file }) {
    const existing = await this.getArsipById(id);

    const data = {};
    if (direction !== undefined) data.direction = direction;
    if (nomorSurat !== undefined) data.nomorSurat = nomorSurat;
    if (tanggalSurat !== undefined) data.tanggalSurat = new Date(tanggalSurat);
    if (pihak !== undefined) data.pihak = pihak;
    if (perihal !== undefined) data.perihal = perihal;
    if (sifat !== undefined) data.sifat = sifat;
    if (keterangan !== undefined) data.keterangan = keterangan || null;

    // tanggal_diterima only meaningful for surat masuk
    const effectiveDirection = direction ?? existing.direction;
    if (tanggalDiterima !== undefined || direction !== undefined) {
      data.tanggalDiterima = effectiveDirection === 'masuk' ? toDateOrNull(tanggalDiterima ?? existing.tanggalDiterima) : null;
    }

    if (file?.path) {
      removeFileIfExists(existing.filePath);
      data.filePath = file.path;
      data.fileType = file.mimetype || null;
    }

    return prisma.arsipSurat.update({
      where: { id: BigInt(id) },
      data,
      include: { createdBy: { select: { id: true, nama: true } } },
    });
  }

  async deleteArsip(id) {
    const existing = await this.getArsipById(id);
    removeFileIfExists(existing.filePath);
    await prisma.arsipSurat.delete({ where: { id: BigInt(id) } });
    return { id: existing.id };
  }

  /**
   * Unified log/arsip: merges manual ArsipSurat entries with system IssuedLetter
   * records (read-time union). IssuedLetter is always treated as outgoing (keluar).
   * In-memory merge is acceptable at kelurahan scale; for larger volumes this can
   * be upgraded to a SQL UNION via $queryRaw.
   */
  async getUnifiedLog({ direction, search, startDate, endDate, page = 1, limit = 50 }) {
    const includeManual = true;
    const includeSystem = direction !== 'masuk'; // system letters are outgoing only

    const arsipWhere = this.buildArsipWhere({ direction, search, startDate, endDate });

    const issuedWhere = {};
    const start = toDateOrNull(startDate);
    const end = toDateOrNull(endDate);
    const issuedAt = {};
    if (start) issuedAt.gte = start;
    if (end) issuedAt.lte = end;
    if (Object.keys(issuedAt).length > 0) issuedWhere.issuedAt = issuedAt;
    if (search && String(search).trim() !== '') {
      issuedWhere.letterNumber = { contains: String(search).trim(), mode: 'insensitive' };
    }

    const [manualEntries, systemEntries] = await Promise.all([
      includeManual
        ? prisma.arsipSurat.findMany({
            where: arsipWhere,
            include: { createdBy: { select: { id: true, nama: true } } },
          })
        : Promise.resolve([]),
      includeSystem
        ? prisma.issuedLetter.findMany({
            where: issuedWhere,
            select: {
              id: true,
              letterNumber: true,
              verificationCode: true,
              type: true,
              keterangan: true,
              pdfPath: true,
              issuedAt: true,
              isRevoked: true,
            },
          })
        : Promise.resolve([]),
    ]);

    const merged = [...manualEntries.map((record) => ({ source: 'manual', record, sortDate: record.tanggalSurat })), ...systemEntries.map((record) => ({ source: 'system', record, sortDate: record.issuedAt }))];

    merged.sort((a, b) => new Date(b.sortDate).getTime() - new Date(a.sortDate).getTime());

    const total = merged.length;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const paged = merged.slice(skip, skip + parseInt(limit));

    return {
      entries: paged,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        total_pages: Math.ceil(total / parseInt(limit)),
      },
    };
  }
}

export default new ArsipService();
