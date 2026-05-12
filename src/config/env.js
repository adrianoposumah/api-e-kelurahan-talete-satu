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
};

export default env;
