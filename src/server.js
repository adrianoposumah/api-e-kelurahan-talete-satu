import dotenv from 'dotenv';

const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development';
dotenv.config({ path: envFile });
dotenv.config();

const { default: app } = await import('./app.js');
const { default: ensureAdmin } = await import('./scripts/ensureAdmin.js');

const PORT = process.env.PORT || 3000;

// In production ensure an admin user exists (reads ADMIN_NOHP & ADMIN_PASSWORD)
if (process.env.NODE_ENV === 'production') {
  ensureAdmin().catch((err) => {
    console.error('Admin seeding failed:', err);
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT} (${process.env.NODE_ENV})`);
});
