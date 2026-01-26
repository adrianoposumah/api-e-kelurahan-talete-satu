import lingkunganService from '../services/lingkungan.service.js';
import { formatLingkunganResponse, formatLingkunganKeplingResponse, formatLingkunganWithKeplingsResponse } from '../utils/formatters.js';

/**
 * Lingkungan Controller - Handles HTTP requests for lingkungan and kepling management
 */
class LingkunganController {
  /**
   * Get all lingkungan
   * GET /lingkungan
   */
  async getAllLingkungan(req, res, next) {
    try {
      const { page, limit } = req.query;
      const result = await lingkunganService.getAllLingkungan({ page, limit });

      // Format lingkungan data
      const formattedLingkungan = result.lingkungan.map(formatLingkunganWithKeplingsResponse);

      res.json({
        success: true,
        message: 'Berhasil mengambil daftar lingkungan',
        data: {
          lingkungan: formattedLingkungan,
          pagination: result.pagination,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get lingkungan by ID
   * GET /lingkungan/:id
   */
  async getLingkunganById(req, res, next) {
    try {
      const { id } = req.params;
      const lingkungan = await lingkunganService.getLingkunganById(id);

      res.json({
        success: true,
        message: 'Berhasil mengambil data lingkungan',
        data: formatLingkunganWithKeplingsResponse(lingkungan),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Create new lingkungan
   * POST /lingkungan
   */
  async createLingkungan(req, res, next) {
    try {
      const { nama, kode } = req.body;

      if (!nama) {
        return res.status(400).json({
          success: false,
          message: 'Nama lingkungan wajib diisi',
        });
      }

      const lingkungan = await lingkunganService.createLingkungan({ nama, kode });

      res.status(201).json({
        success: true,
        message: 'Berhasil membuat lingkungan baru',
        data: formatLingkunganResponse(lingkungan),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update lingkungan
   * PATCH /lingkungan/:id
   */
  async updateLingkungan(req, res, next) {
    try {
      const { id } = req.params;
      const { nama, kode } = req.body;

      const lingkungan = await lingkunganService.updateLingkungan(id, { nama, kode });

      res.json({
        success: true,
        message: 'Berhasil mengupdate lingkungan',
        data: formatLingkunganResponse(lingkungan),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete lingkungan
   * DELETE /lingkungan/:id
   */
  async deleteLingkungan(req, res, next) {
    try {
      const { id } = req.params;
      await lingkunganService.deleteLingkungan(id);

      res.json({
        success: true,
        message: 'Berhasil menghapus lingkungan',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Assign kepling to lingkungan
   * POST /lingkungan/kepling
   */
  async assignKepling(req, res, next) {
    try {
      const { lingkunganId, userId, mulai, selesai } = req.body;

      if (!lingkunganId || !userId || !mulai) {
        return res.status(400).json({
          success: false,
          message: 'lingkunganId, userId, dan mulai wajib diisi',
        });
      }

      const assignment = await lingkunganService.assignKepling({
        lingkunganId,
        userId,
        mulai,
        selesai,
      });

      res.status(201).json({
        success: true,
        message: 'Berhasil menugaskan kepling ke lingkungan',
        data: formatLingkunganKeplingResponse(assignment),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * End kepling assignment
   * PATCH /lingkungan/kepling/:id/end
   */
  async endKeplingAssignment(req, res, next) {
    try {
      const { id } = req.params;
      const { selesai } = req.body;

      const assignment = await lingkunganService.endKeplingAssignment(id, selesai);

      res.json({
        success: true,
        message: 'Berhasil mengakhiri penugasan kepling',
        data: formatLingkunganKeplingResponse(assignment),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get all kepling assignments
   * GET /lingkungan/kepling
   */
  async getAllKeplingAssignments(req, res, next) {
    try {
      const { page, limit, activeOnly } = req.query;
      const result = await lingkunganService.getAllKeplingAssignments({
        page,
        limit,
        activeOnly: activeOnly === 'true',
      });

      const formattedAssignments = result.assignments.map(formatLingkunganKeplingResponse);

      res.json({
        success: true,
        message: 'Berhasil mengambil daftar penugasan kepling',
        data: {
          assignments: formattedAssignments,
          pagination: result.pagination,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get kepling history by user ID
   * GET /lingkungan/kepling/user/:userId
   */
  async getKeplingHistoryByUser(req, res, next) {
    try {
      const { userId } = req.params;
      const assignments = await lingkunganService.getKeplingHistoryByUser(userId);

      const formattedAssignments = assignments.map(formatLingkunganKeplingResponse);

      res.json({
        success: true,
        message: 'Berhasil mengambil riwayat penugasan kepling',
        data: formattedAssignments,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get all active kepling users
   * GET /lingkungan/kepling/active
   */
  async getActiveKeplings(req, res, next) {
    try {
      const { page, limit } = req.query;
      const result = await lingkunganService.getActiveKeplings({ page, limit });

      const formattedKeplings = result.keplings.map(formatLingkunganKeplingResponse);

      res.json({
        success: true,
        message: 'Berhasil mengambil daftar kepling aktif',
        data: {
          keplings: formattedKeplings,
          pagination: result.pagination,
        },
      });
    } catch (error) {
      next(error);
    }
  }
}

export default new LingkunganController();
