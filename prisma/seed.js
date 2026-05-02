import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function randomDigits(length) {
  let s = '';
  for (let i = 0; i < length; i++) s += Math.floor(Math.random() * 10);
  return s;
}

function randomPassword(length = 12) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

async function main() {
  const adminNoHp = process.env.ADMIN_NOHP;
  const adminPassword = process.env.ADMIN_PASSWORD;
  const adminName = process.env.ADMIN_NAME || 'Administrator';

  const userCount = await prisma.user.count();
  if (userCount > 0) {
    console.log('Database already has users — skipping admin seed.');
    return;
  }

  let noHp = adminNoHp;
  let password = adminPassword;

  if (!noHp || !password) {
    noHp = adminNoHp || `08${randomDigits(9)}`;
    password = adminPassword || randomPassword(12);
    console.warn('ADMIN_NOHP or ADMIN_PASSWORD not provided. Creating admin with generated credentials:');
    console.warn(`ADMIN_NOHP=${noHp}`);
    console.warn(`ADMIN_PASSWORD=${password}`);
  }

  const hashed = await bcrypt.hash(password, 10);

  await prisma.user.create({
    data: {
      nama: adminName,
      noHp: noHp,
      password: hashed,
      role: 'admin',
      isValidate: true,
      status: 'active',
    },
  });

  console.log('Admin user created by Prisma seed.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
