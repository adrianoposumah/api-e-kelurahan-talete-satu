import { createReadStream, existsSync } from 'fs';
import { basename, dirname, extname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

import arsipService from '../services/arsip.service.js';
import { validateArsip } from '../validators/arsip.validator.js';
import { formatArsipResponse, formatArsipLogEntry } from '../utils/formatters.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..', '..');

const MIME_TYPES = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
};

/**
 * Arsip Surat Controller - manage external/manual incoming & outgoing letters
 * and the unified archive log. Access restricted to staff & admin via routes.
 */
class ArsipController {
  buildBaseUrl(req) {
    const forwardedProto = req.headers['x-forwarded-proto'];
    const protocol = typeof forwardedProto === 'string' && forwardedProto.length > 0 ? forwardedProto.split(',')[0].trim() : req.protocol;

    return `${protocol}://${req.get('host')}`;
  }

  isDownloadRequest(req) {
    const downloadValue = String(req.query.download || '').toLowerCase();
    return downloadValue === '1' || downloadValue === 'true' || downloadValue === 'yes';
  }

  getMimeType(filePath) {
    return MIME_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream';
  }

  handleError(error, res, next) {
    if (error.code === 'NOT_FOUND') {
      return res.status(404).json({ error: 'Not Found', message: error.message });
    }
    if (error.code === 'FORBIDDEN') {
      return res.status(403).json({ error: 'Forbidden', message: error.message });
    }
    return next(error);
  }

  /**
   * POST /arsip - Create a manual arsip surat (surat masuk / keluar)
   */
  async create(req, res, next) {
    try {
      const validation = validateArsip(req.body);
      if (!validation.valid) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: validation.errors,
        });
      }

      const arsip = await arsipService.createArsip({
        direction: req.body.direction,
        nomorSurat: req.body.nomor_surat,
        tanggalSurat: req.body.tanggal_surat,
        tanggalDiterima: req.body.tanggal_diterima,
        pihak: req.body.pihak,
        perihal: req.body.perihal,
        sifat: req.body.sifat,
        keterangan: req.body.keterangan,
        file: req.file,
        userId: req.user.userId,
      });

      res.status(201).json({
        success: true,
        data: formatArsipResponse(arsip, { baseUrl: this.buildBaseUrl(req) }),
      });
    } catch (error) {
      this.handleError(error, res, next);
    }
  }

  /**
   * GET /arsip - List manual arsip entries (paginated, filterable)
   */
  async list(req, res, next) {
    try {
      const { direction, search, start_date: startDate, end_date: endDate, page, limit } = req.query;

      const { items, pagination } = await arsipService.listArsip({
        direction,
        search,
        startDate,
        endDate,
        page: page || 1,
        limit: limit || 50,
      });

      const baseUrl = this.buildBaseUrl(req);
      res.json({
        data: items.map((item) => formatArsipResponse(item, { baseUrl })),
        pagination,
      });
    } catch (error) {
      this.handleError(error, res, next);
    }
  }

  /**
   * GET /arsip/log - Unified archive log (manual entries + system issued letters)
   */
  async getUnifiedLog(req, res, next) {
    try {
      const { direction, search, start_date: startDate, end_date: endDate, page, limit } = req.query;

      const { entries, pagination } = await arsipService.getUnifiedLog({
        direction,
        search,
        startDate,
        endDate,
        page: page || 1,
        limit: limit || 50,
      });

      const baseUrl = this.buildBaseUrl(req);
      res.json({
        data: entries.map((entry) => formatArsipLogEntry(entry, { baseUrl })),
        pagination,
      });
    } catch (error) {
      this.handleError(error, res, next);
    }
  }

  /**
   * GET /arsip/:id - Get a single arsip entry
   */
  async getById(req, res, next) {
    try {
      const arsip = await arsipService.getArsipById(req.params.id);
      res.json({
        success: true,
        data: formatArsipResponse(arsip, { baseUrl: this.buildBaseUrl(req) }),
      });
    } catch (error) {
      this.handleError(error, res, next);
    }
  }

  /**
   * PATCH /arsip/:id - Update an arsip entry
   */
  async update(req, res, next) {
    try {
      const arsip = await arsipService.updateArsip(req.params.id, {
        direction: req.body.direction,
        nomorSurat: req.body.nomor_surat,
        tanggalSurat: req.body.tanggal_surat,
        tanggalDiterima: req.body.tanggal_diterima,
        pihak: req.body.pihak,
        perihal: req.body.perihal,
        sifat: req.body.sifat,
        keterangan: req.body.keterangan,
        file: req.file,
      });

      res.json({
        success: true,
        data: formatArsipResponse(arsip, { baseUrl: this.buildBaseUrl(req) }),
      });
    } catch (error) {
      this.handleError(error, res, next);
    }
  }

  /**
   * DELETE /arsip/:id - Delete an arsip entry (and its attachment)
   */
  async remove(req, res, next) {
    try {
      await arsipService.deleteArsip(req.params.id);
      res.json({ message: 'Arsip surat berhasil dihapus' });
    } catch (error) {
      this.handleError(error, res, next);
    }
  }

  /**
   * GET /arsip/:id/file - Serve/download the arsip attachment
   */
  async serveFile(req, res, next) {
    try {
      const arsip = await arsipService.getArsipById(req.params.id);

      if (!arsip.filePath) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'Arsip ini tidak memiliki lampiran',
        });
      }

      const absolutePath = resolve(PROJECT_ROOT, arsip.filePath);
      if (!existsSync(absolutePath)) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'File lampiran tidak ditemukan',
        });
      }

      const inline = !this.isDownloadRequest(req);
      const filename = basename(absolutePath);

      res.setHeader('Content-Type', this.getMimeType(absolutePath));
      res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${filename}"`);

      createReadStream(absolutePath).pipe(res);
    } catch (error) {
      this.handleError(error, res, next);
    }
  }
}

export default new ArsipController();
