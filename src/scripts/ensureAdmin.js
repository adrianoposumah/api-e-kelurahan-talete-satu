import bcrypt from 'bcrypt';
import prisma from '../config/prisma.js';

/**
 * Ensure an admin user exists in production.
 * Reads credentials from environment variables:
 *  - ADMIN_NAME (optional)
 *  - ADMIN_NOHP (required)
 *  - ADMIN_PASSWORD (required)
 *
 * If an admin already exists this is a no-op. If a user exists with the
 * provided phone number it will be promoted to `admin`.
 */
export default async function ensureAdmin() {
  try {
    if (process.env.NODE_ENV !== 'production') return;

    const adminNoHp = process.env.ADMIN_NOHP;
    const adminPassword = process.env.ADMIN_PASSWORD;
    const adminName = process.env.ADMIN_NAME || 'Administrator';

    if (!adminNoHp || !adminPassword) {
      console.warn('ADMIN_NOHP or ADMIN_PASSWORD not set — skipping admin seed');
      return;
    }

    const existingAdmin = await prisma.user.findFirst({ where: { role: 'admin' } });
    if (existingAdmin) {
      console.log('Admin user already exists — skipping seed');
      return;
    }

    const existingUser = await prisma.user.findUnique({ where: { noHp: adminNoHp } });
    if (existingUser) {
      await prisma.user.update({ where: { noHp: adminNoHp }, data: { role: 'admin', nama: adminName } });
      console.log(`Promoted existing user ${adminNoHp} to admin`);
      return;
    }

    const hashed = await bcrypt.hash(adminPassword, 10);
    await prisma.user.create({
      data: {
        nama: adminName,
        noHp: adminNoHp,
        password: hashed,
        role: 'admin',
        isValidate: true,
        status: 'active',
      },
    });

    console.log(`Admin user ${adminNoHp} created`);
  } catch (err) {
    console.error('Failed to ensure admin user:', err);
    throw err;
  }
}
