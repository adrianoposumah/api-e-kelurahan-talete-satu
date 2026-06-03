import 'dotenv/config';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const TZ = process.env.TZ || 'Asia/Makassar';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  options: `-c timezone=${TZ}`,
});

const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({ adapter });

export default prisma;
