import { readFile } from 'fs/promises';
import { readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TEMPLATES_DIR = join(__dirname, '..', 'templates');

/**
 * Template Service - Handles letter template loading and rendering
 */
class TemplateService {
  constructor() {
    this.templateCache = new Map();
    this.schemaCache = new Map();
  }

  /**
   * Get available letter types
   * @returns {string[]} List of letter types
   */
  getAvailableTypes() {
    try {
      return readdirSync(TEMPLATES_DIR, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
    } catch {
      return [];
    }
  }

  /**
   * Load template schema for a letter type
   * @param {string} type - Letter type
   * @returns {Promise<object>} Template schema
   */
  async getSchema(type) {
    if (this.schemaCache.has(type)) {
      return this.schemaCache.get(type);
    }

    const schemaPath = join(TEMPLATES_DIR, type, 'schema.json');
    try {
      const content = await readFile(schemaPath, 'utf-8');
      const parsed = JSON.parse(content);
      const fields = Array.isArray(parsed.fields) ? parsed.fields : Array.isArray(parsed.requiredFields) ? parsed.requiredFields : [];

      const normalized = {
        ...parsed,
        name: parsed.name || parsed.label || type,
        label: parsed.label || parsed.name || type,
        fields,
        files: Array.isArray(parsed.files) ? parsed.files : [],
        requiredFields: Array.isArray(parsed.requiredFields) ? parsed.requiredFields : fields,
        autoPopulatedFields: Array.isArray(parsed.autoPopulatedFields) ? parsed.autoPopulatedFields : [],
      };

      this.schemaCache.set(type, normalized);
      return normalized;
    } catch {
      const err = new Error(`Template schema untuk tipe '${type}' tidak ditemukan`);
      err.code = 'NOT_FOUND';
      throw err;
    }
  }

  /**
   * Load HTML template for a letter type
   * @param {string} type - Letter type
   * @returns {Promise<string>} HTML template
   */
  async getTemplate(type) {
    if (this.templateCache.has(type)) {
      return this.templateCache.get(type);
    }

    const templatePath = join(TEMPLATES_DIR, type, 'template.html');
    try {
      const content = await readFile(templatePath, 'utf-8');
      this.templateCache.set(type, content);
      return content;
    } catch {
      const err = new Error(`Template HTML untuk tipe '${type}' tidak ditemukan`);
      err.code = 'NOT_FOUND';
      throw err;
    }
  }

  /**
   * Validate payload against schema
   * @param {string} type - Letter type
   * @param {object} payload - Payload to validate
   * @returns {Promise<object>} Validation result
   */
  async validatePayload(type, payload) {
    const schema = await this.getSchema(type);
    const errors = [];

    for (const field of schema.requiredFields) {
      const value = payload[field.name];

      // Check required
      if (field.required && (value === undefined || value === null || value === '')) {
        errors.push(`Field '${field.label}' wajib diisi`);
        continue;
      }

      if (value !== undefined && value !== null && value !== '') {
        // Check type
        if (field.type === 'number' && typeof value !== 'number') {
          errors.push(`Field '${field.label}' harus berupa angka`);
        }

        // Check maxLength
        if (field.maxLength && typeof value === 'string' && value.length > field.maxLength) {
          errors.push(`Field '${field.label}' maksimal ${field.maxLength} karakter`);
        }

        // Check min/max for numbers
        if (field.type === 'number') {
          if (field.min !== undefined && value < field.min) {
            errors.push(`Field '${field.label}' minimal ${field.min}`);
          }
          if (field.max !== undefined && value > field.max) {
            errors.push(`Field '${field.label}' maksimal ${field.max}`);
          }
        }

        // Check exact length
        if (field.length && typeof value === 'string' && value.length !== field.length) {
          errors.push(`Field '${field.label}' harus ${field.length} karakter`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Render template with data
   * @param {string} type - Letter type
   * @param {object} data - Data to render
   * @returns {Promise<string>} Rendered HTML
   */
  async renderTemplate(type, data) {
    let template = await this.getTemplate(type);

    // Replace all placeholders
    for (const [key, value] of Object.entries(data)) {
      const placeholder = `{{${key.toUpperCase()}}}`;
      template = template.replaceAll(placeholder, value ?? '');
    }

    return template;
  }

  /**
   * Format date to Indonesian format
   * @param {Date} date - Date to format
   * @returns {string} Formatted date
   */
  formatDate(date) {
    const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    const d = new Date(date);
    return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
  }

  /**
   * Format gender to Indonesian
   * @param {string} gender - L or P
   * @returns {string} Formatted gender
   */
  formatGender(gender) {
    return gender === 'L' ? 'Laki-laki' : 'Perempuan';
  }

  /**
   * Prepare data for template from submission and kependudukan
   * @param {object} submission - Submission object with relations
   * @param {object} options - Additional options
   * @returns {object} Template data
   */
  prepareTemplateData(submission, options = {}) {
    const { kependudukan } = submission.user;
    const { lingkungan } = submission;
    const payload = submission.payload || {};

    const baseData = {
      // Auto-populated from kependudukan
      nama_lengkap: kependudukan.nama,
      nik: kependudukan.nik,
      jenis_kelamin: this.formatGender(kependudukan.jenisKelamin),
      tempat_lahir: kependudukan.tempatLahir,
      tanggal_lahir: this.formatDate(kependudukan.tanggalLahir),
      pekerjaan: kependudukan.pekerjaan,
      agama: kependudukan.agama,
      kewarganegaraan: kependudukan.kewarganegaraan,
      alamat: kependudukan.alamat,
      lingkungan: lingkungan.nama,

      // Letter metadata
      nomor_surat: options.letterNumber || '',
      tanggal_penerbitan: this.formatDate(new Date()),
      nama_lurah: options.lurahName || '',
      nip_lurah: options.lurahNip || '',

      // URLs
      logo_url: options.logoUrl || '',
      qr_code_data: options.qrCodeData || '',
      verification_url: options.verificationUrl || '',

      // Spread payload fields
      ...payload,
    };

    // Convert all keys to uppercase for template
    const templateData = {};
    for (const [key, value] of Object.entries(baseData)) {
      templateData[key.toUpperCase()] = value;
      templateData[key] = value; // Keep lowercase too for flexibility
    }

    return templateData;
  }
}

export default new TemplateService();
