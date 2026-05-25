const env = {
  PORT: parseInt(process.env.PORT, 10),
  TZ: process.env.TZ,
  DATABASE_URL: process.env.DATABASE_URL,
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN,
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN,
  VERIFICATION_URL: process.env.VERIFICATION_URL,
  ADMIN_DASHBOARD_URL: process.env.ADMIN_DASHBOARD_URL,
  KELURAHAN_CODE: process.env.KELURAHAN_CODE || '2009',
  ROOT_CA_CERT_PATH: process.env.ROOT_CA_CERT_PATH || 'secure-storage/root-ca-cert.pem',
  ROOT_CA_KEY_PATH: process.env.ROOT_CA_KEY_PATH || 'secure-storage/root-ca-key.pem',
  ROOT_CA_KEY_PASSPHRASE: process.env.ROOT_CA_KEY_PASSPHRASE,
  PDF_STORAGE_DIR: process.env.PDF_STORAGE_DIR || 'public/letters',
  PDF_DRAFT_DIR: process.env.PDF_DRAFT_DIR || 'storage/letter-drafts',
};

export default env;
