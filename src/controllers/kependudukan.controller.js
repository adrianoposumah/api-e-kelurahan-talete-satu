import kependudukanService from '../services/kependudukan.service.js';
import { formatKependudukanManagementResponse } from '../utils/formatters.js';

/**
 * Kependudukan Controller - Handles data kependudukan request/response
 */
class KependudukanController {
  /**
   * POST /data-kependudukan/batch-upload - Batch create data from xlsx file
   */
  async batchCreateData(req, res, next) {
    try {
      if (!req.file) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'File .xlsx wajib diupload dengan field "file"',
        });
      }

      const result = await kependudukanService.batchCreateDataFromXlsx(req.file.buffer);
      const statusCode = result.failed_count > 0 ? 200 : 201;

      res.status(statusCode).json({
        message: 'Batch upload data kependudukan selesai diproses',
        data: result,
      });
    } catch (error) {
      if (error.code === 'BAD_REQUEST') {
        return res.status(400).json({
          error: 'Bad Request',
          message: error.message,
        });
      }
      next(error);
    }
  }

  /**
   * GET /data-kependudukan - Get all data kependudukan
   */
  async getAllData(req, res, next) {
    try {
      const { page, limit, search, lingkungan_id, jenis_kelamin, status_kawin } = req.query;

      const { data, pagination } = await kependudukanService.getAllData({
        page,
        limit,
        search,
        lingkunganId: lingkungan_id,
        jenisKelamin: jenis_kelamin,
        statusKawin: status_kawin,
      });

      res.json({
        data: data.map(formatKependudukanManagementResponse),
        pagination,
      });
    } catch (error) {
      if (error.code === 'BAD_REQUEST') {
        return res.status(400).json({
          error: 'Bad Request',
          message: error.message,
        });
      }
      next(error);
    }
  }

  /**
   * GET /data-kependudukan/masked - Get masked kependudukan data
   */
  async getMaskedKependudukan(req, res, next) {
    try {
      const { nik } = req.query;

      const data = await kependudukanService.getMaskedKependudukan({ nik });

      res.json({
        data,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /data-kependudukan/:nik - Get data kependudukan by NIK
   */
  async getByNik(req, res, next) {
    try {
      const { nik } = req.params;

      const data = await kependudukanService.getByNik(nik);

      res.json(formatKependudukanManagementResponse(data));
    } catch (error) {
      if (error.code === 'NOT_FOUND') {
        return res.status(404).json({
          error: 'Not Found',
          message: error.message,
        });
      }
      next(error);
    }
  }

  /**
   * POST /data-kependudukan - Create data kependudukan
   */
  async createData(req, res, next) {
    try {
      const { nik, nama, tempat_lahir, tanggal_lahir, jenis_kelamin, golongan_darah, alamat, rt, rw, lingkungan_id, kelurahan, kecamatan, kabupaten_kota, provinsi, status_kawin, agama, pekerjaan, kewarganegaraan } = req.body;

      const requiredFields = ['nik', 'nama', 'tempat_lahir', 'tanggal_lahir', 'jenis_kelamin', 'alamat', 'kelurahan', 'kecamatan', 'kabupaten_kota', 'provinsi', 'status_kawin', 'agama', 'pekerjaan'];

      const missingFields = requiredFields.filter((field) => {
        return req.body[field] === undefined || req.body[field] === null || req.body[field] === '';
      });

      if (missingFields.length > 0) {
        return res.status(400).json({
          error: 'Bad Request',
          message: `Field wajib belum diisi: ${missingFields.join(', ')}`,
        });
      }

      const createdData = await kependudukanService.createData({
        nik,
        nama,
        tempatLahir: tempat_lahir,
        tanggalLahir: tanggal_lahir,
        jenisKelamin: jenis_kelamin,
        golonganDarah: golongan_darah,
        alamat,
        rt,
        rw,
        lingkunganId: lingkungan_id,
        kelurahan,
        kecamatan,
        kabupatenKota: kabupaten_kota,
        provinsi,
        statusKawin: status_kawin,
        agama,
        pekerjaan,
        kewarganegaraan,
      });

      res.status(201).json({
        message: 'Data kependudukan berhasil dibuat',
        data: formatKependudukanManagementResponse(createdData),
      });
    } catch (error) {
      if (error.code === 'BAD_REQUEST') {
        return res.status(400).json({
          error: 'Bad Request',
          message: error.message,
        });
      }
      if (error.code === 'CONFLICT') {
        return res.status(409).json({
          error: 'Conflict',
          message: error.message,
        });
      }
      if (error.code === 'NOT_FOUND') {
        return res.status(404).json({
          error: 'Not Found',
          message: error.message,
        });
      }
      next(error);
    }
  }

  /**
   * PATCH /data-kependudukan/:nik - Update data kependudukan by NIK
   */
  async updateData(req, res, next) {
    try {
      const { nik } = req.params;

      if (req.body.nik !== undefined && req.body.nik !== nik) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'NIK pada body tidak boleh berbeda dengan parameter URL',
        });
      }

      const updatedData = await kependudukanService.updateData(nik, {
        nama: req.body.nama,
        tempatLahir: req.body.tempat_lahir,
        tanggalLahir: req.body.tanggal_lahir,
        jenisKelamin: req.body.jenis_kelamin,
        golonganDarah: req.body.golongan_darah,
        alamat: req.body.alamat,
        rt: req.body.rt,
        rw: req.body.rw,
        lingkunganId: req.body.lingkungan_id,
        kelurahan: req.body.kelurahan,
        kecamatan: req.body.kecamatan,
        kabupatenKota: req.body.kabupaten_kota,
        provinsi: req.body.provinsi,
        statusKawin: req.body.status_kawin,
        agama: req.body.agama,
        pekerjaan: req.body.pekerjaan,
        kewarganegaraan: req.body.kewarganegaraan,
      });

      res.json({
        message: 'Data kependudukan berhasil diupdate',
        data: formatKependudukanManagementResponse(updatedData),
      });
    } catch (error) {
      if (error.code === 'BAD_REQUEST') {
        return res.status(400).json({
          error: 'Bad Request',
          message: error.message,
        });
      }
      if (error.code === 'NOT_FOUND') {
        return res.status(404).json({
          error: 'Not Found',
          message: error.message,
        });
      }
      next(error);
    }
  }

  /**
   * DELETE /data-kependudukan/:nik - Delete data kependudukan by NIK
   */
  async deleteData(req, res, next) {
    try {
      const { nik } = req.params;

      await kependudukanService.deleteData(nik);

      res.json({
        message: 'Data kependudukan berhasil dihapus',
      });
    } catch (error) {
      if (error.code === 'BAD_REQUEST') {
        return res.status(400).json({
          error: 'Bad Request',
          message: error.message,
        });
      }
      if (error.code === 'NOT_FOUND') {
        return res.status(404).json({
          error: 'Not Found',
          message: error.message,
        });
      }
      next(error);
    }
  }
}

export default new KependudukanController();
