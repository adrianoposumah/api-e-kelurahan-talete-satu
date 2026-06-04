import prisma from '../config/prisma.js';

const PENDING_STATUSES = ['pending_kepling', 'pending_lurah'];
const TREND_MONTHS = 6;

/**
 * Build the YYYY-MM key for a date using the server local timezone
 * (process.env.TZ is set to Asia/Makassar, so local methods are correct).
 */
const monthKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

/**
 * Dashboard statistics service - read-only aggregations for the admin/staff
 * home dashboard. Does not modify any core data.
 */
class DashboardService {
  async getOverview() {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const trendStart = new Date(now.getFullYear(), now.getMonth() - (TREND_MONTHS - 1), 1);

    const [
      totalSubmissions,
      pendingSubmissions,
      issuedLetters,
      issuedThisMonth,
      revokedLetters,
      totalPenduduk,
      arsipMasuk,
      arsipKeluar,
      byStatus,
      byType,
      byLingkungan,
      submissionDates,
      issuedDates,
      recentSubmissions,
    ] = await Promise.all([
      prisma.submission.count(),
      prisma.submission.count({ where: { status: { in: PENDING_STATUSES } } }),
      prisma.issuedLetter.count(),
      prisma.issuedLetter.count({ where: { issuedAt: { gte: startOfMonth } } }),
      prisma.issuedLetter.count({ where: { isRevoked: true } }),
      prisma.dataKependudukan.count(),
      prisma.arsipSurat.count({ where: { direction: 'masuk' } }),
      prisma.arsipSurat.count({ where: { direction: 'keluar' } }),
      prisma.submission.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.submission.groupBy({ by: ['type'], _count: { _all: true } }),
      prisma.submission.groupBy({ by: ['lingkunganId'], _count: { _all: true } }),
      prisma.submission.findMany({ where: { createdAt: { gte: trendStart } }, select: { createdAt: true } }),
      prisma.issuedLetter.findMany({ where: { issuedAt: { gte: trendStart } }, select: { issuedAt: true } }),
      prisma.submission.findMany({
        where: { status: { in: PENDING_STATUSES } },
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { nama: true } },
          lingkungan: { select: { nama: true } },
        },
      }),
    ]);

    // Top 8 lingkungan by submission count, mapped to their names.
    const topLingkungan = [...byLingkungan].sort((a, b) => b._count._all - a._count._all).slice(0, 8);
    const lingkunganIds = topLingkungan.map((entry) => entry.lingkunganId);
    const lingkunganRecords = lingkunganIds.length ? await prisma.lingkungan.findMany({ where: { id: { in: lingkunganIds } }, select: { id: true, nama: true } }) : [];
    const lingkunganNameById = new Map(lingkunganRecords.map((row) => [row.id.toString(), row.nama]));

    // Ordered 6-month trend buckets.
    const trendBuckets = [];
    const trendIndex = new Map();
    for (let offset = TREND_MONTHS - 1; offset >= 0; offset -= 1) {
      const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      const key = monthKey(date);
      const bucket = { month: key, submissions: 0, issued: 0 };
      trendBuckets.push(bucket);
      trendIndex.set(key, bucket);
    }

    for (const row of submissionDates) {
      const bucket = trendIndex.get(monthKey(row.createdAt));
      if (bucket) bucket.submissions += 1;
    }

    for (const row of issuedDates) {
      const bucket = trendIndex.get(monthKey(row.issuedAt));
      if (bucket) bucket.issued += 1;
    }

    return {
      cards: {
        total_submissions: totalSubmissions,
        pending_submissions: pendingSubmissions,
        issued_letters: issuedLetters,
        issued_this_month: issuedThisMonth,
        revoked_letters: revokedLetters,
        total_penduduk: totalPenduduk,
        arsip_masuk: arsipMasuk,
        arsip_keluar: arsipKeluar,
      },
      submissions_by_status: byStatus.map((entry) => ({
        status: entry.status,
        count: entry._count._all,
      })),
      submissions_by_type: byType.map((entry) => ({
        type: entry.type,
        count: entry._count._all,
      })),
      submissions_by_lingkungan: topLingkungan.map((entry) => ({
        lingkungan_id: entry.lingkunganId.toString(),
        nama: lingkunganNameById.get(entry.lingkunganId.toString()) || `Lingkungan ${entry.lingkunganId.toString()}`,
        count: entry._count._all,
      })),
      monthly_trend: trendBuckets,
      recent_submissions: recentSubmissions.map((submission) => ({
        id: submission.id.toString(),
        type: submission.type,
        status: submission.status,
        nama: submission.user?.nama || null,
        lingkungan: submission.lingkungan?.nama || null,
        created_at: submission.createdAt,
      })),
    };
  }
}

export default new DashboardService();
