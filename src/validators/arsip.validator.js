const DIRECTIONS = new Set(['masuk', 'keluar']);
const SIFAT = new Set(['biasa', 'penting', 'segera', 'rahasia']);

const isBlank = (value) => value === undefined || value === null || String(value).trim() === '';

const isValidDate = (value) => !Number.isNaN(new Date(value).getTime());

/**
 * Validate arsip surat payload (surat masuk / surat keluar).
 * @param {object} body
 * @returns {{ valid: boolean, errors: string[] }}
 */
export const validateArsip = (body) => {
  const errors = [];
  const data = body || {};

  if (!DIRECTIONS.has(String(data.direction))) {
    errors.push("Field 'direction' must be one of: masuk, keluar");
  }

  const requiredFields = ['nomor_surat', 'tanggal_surat', 'pihak', 'perihal'];
  for (const field of requiredFields) {
    if (isBlank(data[field])) {
      errors.push(`Field '${field}' is required`);
    }
  }

  if (!isBlank(data.tanggal_surat) && !isValidDate(data.tanggal_surat)) {
    errors.push("Field 'tanggal_surat' must be a valid date");
  }

  if (!isBlank(data.tanggal_diterima) && !isValidDate(data.tanggal_diterima)) {
    errors.push("Field 'tanggal_diterima' must be a valid date");
  }

  if (!isBlank(data.sifat) && !SIFAT.has(String(data.sifat))) {
    errors.push("Field 'sifat' must be one of: biasa, penting, segera, rahasia");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
};

export default validateArsip;
