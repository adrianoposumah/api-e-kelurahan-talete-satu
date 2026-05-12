import prisma from '../config/prisma.js';
import letterService from './letter.service.js';
import { sendToUser } from './notification.service.js';

const parseBigIntFilter = (value, fieldName) => {
  try {
    return BigInt(value);
  } catch {
    const error = new Error(`${fieldName} harus berupa angka yang valid`);
    error.code = 'BAD_REQUEST';
    throw error;
  }
};

const parseCreatedAtSort = (value) => {
  if (!value) return 'asc';

  const direction = String(value).toLowerCase();
  if (direction === 'asc' || direction === 'desc') {
    return direction;
  }

  const error = new Error('created_at harus bernilai asc atau desc');
  error.code = 'BAD_REQUEST';
  throw error;
};

const isEnabledQuery = (value) => value !== undefined && value !== false && value !== 'false' && value !== '0';

const buildSubmissionHistoryStatusFilter = ({ diterima, ditolak, rejectionStages }) => {
  const showDiterima = isEnabledQuery(diterima);
  const showDitolak = isEnabledQuery(ditolak);
  const showAll = !showDiterima && !showDitolak;
  const statusFilter = [];

  if (showDiterima || showAll) {
    statusFilter.push({ status: { in: ['approved', 'issued'] } });
  }

  if (showDitolak || showAll) {
    statusFilter.push({
      status: 'rejected',
      approvals: {
        some: {
          stage: Array.isArray(rejectionStages) ? { in: rejectionStages } : rejectionStages,
          status: 'rejected',
        },
      },
    });
  }

  return statusFilter;
};

/**
 * Submission Service - Handles submission workflow business logic
 */
class SubmissionService {
  async getActiveLurahUserId() {
    try {
      const activeLurah = await prisma.lurahProfile.findFirst({
        where: { isActive: true },
        select: { userId: true },
      });

      return activeLurah?.userId ?? null;
    } catch (error) {
      console.error('Failed to get active Lurah for notification:', error);
      return null;
    }
  }

  async sendSubmissionNotification(userId, payload, logContext) {
    if (!userId) return;

    try {
      await sendToUser(userId, payload);
    } catch (error) {
      console.error(`Failed to send notification ${logContext}:`, error);
    }
  }

  /**
   * Create a new submission
   * @param {object} data - Submission data
   * @returns {Promise<object>} Created submission
   */
  async createSubmission({ userId, letterType, formData, files }) {
    // Get user with kependudukan to determine lingkungan
    const user = await prisma.user.findUnique({
      where: { id: BigInt(userId) },
      include: {
        kependudukan: true,
      },
    });

    if (!user) {
      const error = new Error('User tidak ditemukan');
      error.code = 'NOT_FOUND';
      throw error;
    }

    if (!user.isValidate || !user.kependudukan) {
      const error = new Error('User belum tervalidasi. Silakan validasi akun terlebih dahulu');
      error.code = 'FORBIDDEN';
      throw error;
    }

    const lingkunganId = user.kependudukan.lingkunganId;
    if (!lingkunganId) {
      const error = new Error('User tidak memiliki lingkungan yang terdaftar');
      error.code = 'BAD_REQUEST';
      throw error;
    }

    // Verify lingkungan has an active kepling
    const activeKepling = await prisma.lingkunganKepling.findFirst({
      where: {
        lingkunganId: lingkunganId,
        selesai: null, // Active assignment
      },
    });

    if (!activeKepling) {
      const error = new Error('Lingkungan belum memiliki kepling yang aktif');
      error.code = 'BAD_REQUEST';
      throw error;
    }

    const documentRows = Object.entries(files || {}).map(([fileType, filePath]) => ({
      filePath,
      fileType,
      description: null,
    }));

    // Create submission with status pending_kepling and uploaded documents
    const submission = await prisma.submission.create({
      data: {
        userId: BigInt(userId),
        lingkunganId,
        type: letterType,
        status: 'pending_kepling',
        payload: formData || null,
        ...(documentRows.length > 0
          ? {
              documents: {
                create: documentRows,
              },
            }
          : {}),
      },
      include: {
        user: true,
        lingkungan: {
          include: {
            keplings: {
              where: { selesai: null },
              include: { user: true },
            },
          },
        },
        documents: true,
        approvals: {
          include: { approver: true },
        },
      },
    });

    try {
      await sendToUser(activeKepling.userId, {
        title: 'Pengajuan Surat Baru',
        body: `Ada pengajuan ${letterType} baru dari ${user.nama} yang memerlukan persetujuan Anda.`,
        data: {
          submissionId: submission.id.toString(),
          type: 'submission_created',
        },
      });
    } catch (error) {
      console.error('Failed to send notification to Kepling:', error);
    }

    return submission;
  }

  /**
   * Get submissions for a citizen (warga)
   * @param {object} options - Query options
   * @returns {Promise<object>} Submissions and pagination
   */
  async getSubmissionsByUser({ userId, page = 1, limit = 50, type, diproses, selesai }) {
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const isEnabled = (value) => value !== undefined && value !== false && value !== 'false' && value !== '0';
    const showDiproses = isEnabled(diproses);
    const showSelesai = isEnabled(selesai);
    const statusFilter = [];

    if (showDiproses || (!showDiproses && !showSelesai)) {
      statusFilter.push({ status: { in: ['pending_kepling', 'pending_lurah'] } });
    }

    if (showSelesai || (!showDiproses && !showSelesai)) {
      statusFilter.push({ status: { in: ['rejected', 'approved'] } });
    }

    const where = {
      userId: BigInt(userId),
      OR: statusFilter,
    };
    if (type) where.type = type;

    const [submissions, total] = await Promise.all([
      prisma.submission.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          userId: true,
          lingkunganId: true,
          type: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          user: {
            select: {
              nama: true,
            },
          },
        },
      }),
      prisma.submission.count({ where }),
    ]);

    return {
      submissions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        total_pages: Math.ceil(total / parseInt(limit)),
      },
    };
  }

  /**
   * Get submission detail by ID for the owner (warga)
   * @param {object} options - Query options
   * @returns {Promise<object>} Submission detail
   */
  async getSubmissionUserDetailById({ submissionId, userId }) {
    const submission = await prisma.submission.findFirst({
      where: {
        id: BigInt(submissionId),
        userId: BigInt(userId),
      },
      include: {
        user: {
          include: { kependudukan: true },
        },
        lingkungan: {
          include: {
            keplings: {
              where: { selesai: null },
              include: { user: true },
            },
          },
        },
        documents: true,
        approvals: {
          include: { approver: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!submission) {
      const error = new Error('Submission tidak ditemukan');
      error.code = 'NOT_FOUND';
      throw error;
    }

    return submission;
  }

  /**
   * Get submissions for kepling's lingkungan
   * @param {object} options - Query options
   * @returns {Promise<object>} Submissions and pagination
   */
  async getSubmissionsForKepling({ keplingUserId, page = 1, limit = 10, type, diproses, selesai }) {
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const isEnabled = (value) => value !== undefined && value !== false && value !== 'false' && value !== '0';
    const showDiproses = isEnabled(diproses);
    const showSelesai = isEnabled(selesai);
    const statusFilter = [];

    if (showDiproses || (!showDiproses && !showSelesai)) {
      statusFilter.push({ status: 'pending_kepling' });
    }

    if (showSelesai || (!showDiproses && !showSelesai)) {
      statusFilter.push(
        { status: 'pending_lurah' },
        { status: { in: ['approved', 'issued'] } },
        {
          status: 'rejected',
          approvals: {
            some: {
              stage: { in: ['kepling', 'lurah'] },
              status: 'rejected',
            },
          },
        },
      );
    }

    // Get kepling's active lingkungan assignments
    const keplingAssignments = await prisma.lingkunganKepling.findMany({
      where: {
        userId: BigInt(keplingUserId),
        selesai: null, // Active only
      },
    });

    if (keplingAssignments.length === 0) {
      const error = new Error('Kepling tidak memiliki lingkungan yang ditugaskan');
      error.code = 'FORBIDDEN';
      throw error;
    }

    const lingkunganIds = keplingAssignments.map((a) => a.lingkunganId);

    const where = {
      lingkunganId: { in: lingkunganIds },
      OR: statusFilter,
    };
    if (type) where.type = type;

    const [submissions, total] = await Promise.all([
      prisma.submission.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          userId: true,
          lingkunganId: true,
          type: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          user: {
            select: {
              nama: true,
            },
          },
        },
      }),
      prisma.submission.count({ where }),
    ]);

    return {
      submissions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        total_pages: Math.ceil(total / parseInt(limit)),
      },
    };
  }

  /**
   * Get completed submission history for kepling's lingkungan
   * @param {object} options - Query options
   * @returns {Promise<object>} Submissions and pagination
   */
  async getSubmissionHistoryForKepling({ keplingUserId, page = 1, limit = 10, type, diterima, ditolak }) {
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const statusFilter = buildSubmissionHistoryStatusFilter({
      diterima,
      ditolak,
      rejectionStages: ['kepling', 'lurah'],
    });

    // Get kepling's active lingkungan assignments
    const keplingAssignments = await prisma.lingkunganKepling.findMany({
      where: {
        userId: BigInt(keplingUserId),
        selesai: null, // Active only
      },
    });

    if (keplingAssignments.length === 0) {
      const error = new Error('Kepling tidak memiliki lingkungan yang ditugaskan');
      error.code = 'FORBIDDEN';
      throw error;
    }

    const lingkunganIds = keplingAssignments.map((a) => a.lingkunganId);

    const where = {
      lingkunganId: { in: lingkunganIds },
      OR: statusFilter,
    };
    if (type) where.type = type;

    const [submissions, total] = await Promise.all([
      prisma.submission.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          userId: true,
          lingkunganId: true,
          type: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          user: {
            select: {
              nama: true,
            },
          },
        },
      }),
      prisma.submission.count({ where }),
    ]);

    return {
      submissions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        total_pages: Math.ceil(total / parseInt(limit)),
      },
    };
  }

  /**
   * Get submission detail by ID for kepling
   * @param {object} options - Query options
   * @returns {Promise<object>} Submission detail
   */
  async getSubmissionKeplingDetailById({ submissionId, keplingUserId }) {
    // Get kepling's active lingkungan assignments
    const keplingAssignments = await prisma.lingkunganKepling.findMany({
      where: {
        userId: BigInt(keplingUserId),
        selesai: null,
      },
    });

    if (keplingAssignments.length === 0) {
      const error = new Error('Kepling tidak memiliki lingkungan yang ditugaskan');
      error.code = 'FORBIDDEN';
      throw error;
    }

    const lingkunganIds = keplingAssignments.map((a) => a.lingkunganId);

    const submission = await prisma.submission.findFirst({
      where: {
        id: BigInt(submissionId),
        lingkunganId: { in: lingkunganIds },
      },
      include: {
        user: {
          include: { kependudukan: true },
        },
        lingkungan: {
          include: {
            keplings: {
              where: { selesai: null },
              include: { user: true },
            },
          },
        },
        documents: true,
        approvals: {
          include: { approver: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!submission) {
      const error = new Error('Submission tidak ditemukan');
      error.code = 'NOT_FOUND';
      throw error;
    }

    return submission;
  }

  /**
   * Get all submissions for lurah
   * @param {object} options - Query options
   * @returns {Promise<object>} Submissions and pagination
   */
  async getSubmissionsForLurah({ page = 1, limit = 50, type, diproses, selesai }) {
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const isEnabled = (value) => value !== undefined && value !== false && value !== 'false' && value !== '0';
    const showDiproses = isEnabled(diproses);
    const showSelesai = isEnabled(selesai);
    const statusFilter = [];

    if (showDiproses || (!showDiproses && !showSelesai)) {
      statusFilter.push({ status: 'pending_lurah' });
    }

    if (showSelesai || (!showDiproses && !showSelesai)) {
      statusFilter.push(
        { status: 'approved' },
        {
          status: 'rejected',
          approvals: {
            some: {
              stage: 'lurah',
              status: 'rejected',
            },
          },
        },
      );
    }

    const where = {
      OR: statusFilter,
    };
    if (type) where.type = type;

    const [submissions, total] = await Promise.all([
      prisma.submission.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          userId: true,
          lingkunganId: true,
          type: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          user: {
            select: {
              nama: true,
            },
          },
        },
      }),
      prisma.submission.count({ where }),
    ]);

    return {
      submissions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        total_pages: Math.ceil(total / parseInt(limit)),
      },
    };
  }

  /**
   * Get completed submission history for lurah
   * @param {object} options - Query options
   * @returns {Promise<object>} Submissions and pagination
   */
  async getSubmissionHistoryForLurah({ page = 1, limit = 50, type, diterima, ditolak }) {
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const statusFilter = buildSubmissionHistoryStatusFilter({
      diterima,
      ditolak,
      rejectionStages: 'lurah',
    });

    const where = {
      OR: statusFilter,
    };
    if (type) where.type = type;

    const [submissions, total] = await Promise.all([
      prisma.submission.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          userId: true,
          lingkunganId: true,
          type: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          user: {
            select: {
              nama: true,
            },
          },
        },
      }),
      prisma.submission.count({ where }),
    ]);

    return {
      submissions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        total_pages: Math.ceil(total / parseInt(limit)),
      },
    };
  }

  /**
   * Get submission detail by ID for lurah
   * @param {object} options - Query options
   * @returns {Promise<object>} Submission detail
   */
  async getSubmissionLurahDetailById({ submissionId }) {
    const submission = await prisma.submission.findUnique({
      where: { id: BigInt(submissionId) },
      include: {
        user: {
          include: { kependudukan: true },
        },
        lingkungan: {
          include: {
            keplings: {
              where: { selesai: null },
              include: { user: true },
            },
          },
        },
        documents: true,
        approvals: {
          include: { approver: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!submission) {
      const error = new Error('Submission tidak ditemukan');
      error.code = 'NOT_FOUND';
      throw error;
    }

    return submission;
  }

  /**
   * Get all submissions for admin monitoring
   * @param {object} options - Query options
   * @returns {Promise<object>} Submissions and pagination
   */
  async getSubmissionsForAdmin({ page = 1, limit = 10, type, status, lingkungan, createdAt, search }) {
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const createdAtSort = parseCreatedAtSort(createdAt);

    const where = {};
    if (type) where.type = type;
    if (status) where.status = status;
    if (lingkungan) where.lingkunganId = parseBigIntFilter(lingkungan, 'lingkungan');
    if (search) {
      where.user = {
        nama: {
          contains: search,
          mode: 'insensitive',
        },
      };
    }

    const [submissions, total] = await Promise.all([
      prisma.submission.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: createdAtSort },
        select: {
          id: true,
          userId: true,
          lingkunganId: true,
          type: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          user: {
            select: {
              nama: true,
            },
          },
        },
      }),
      prisma.submission.count({ where }),
    ]);

    return {
      submissions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        total_pages: Math.ceil(total / parseInt(limit)),
      },
    };
  }

  /**
   * Get submission detail by ID for admin monitoring
   * @param {object} options - Query options
   * @returns {Promise<object>} Submission detail
   */
  async getSubmissionAdminDetailById({ submissionId }) {
    const submission = await prisma.submission.findUnique({
      where: { id: BigInt(submissionId) },
      include: {
        user: {
          include: { kependudukan: true },
        },
        lingkungan: {
          include: {
            keplings: {
              where: { selesai: null },
              include: { user: true },
            },
          },
        },
        documents: true,
        approvals: {
          include: { approver: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!submission) {
      const error = new Error('Submission tidak ditemukan');
      error.code = 'NOT_FOUND';
      throw error;
    }

    return submission;
  }

  /**
   * Get submission by ID
   * @param {string} submissionId - Submission ID
   * @returns {Promise<object>} Submission
   */
  async getSubmissionById(submissionId) {
    const submission = await prisma.submission.findUnique({
      where: { id: BigInt(submissionId) },
      include: {
        user: {
          include: { kependudukan: true },
        },
        lingkungan: {
          include: {
            keplings: {
              where: { selesai: null },
              include: { user: true },
            },
          },
        },
        documents: true,
        approvals: {
          include: { approver: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!submission) {
      const error = new Error('Submission tidak ditemukan');
      error.code = 'NOT_FOUND';
      throw error;
    }

    return submission;
  }

  /**
   * Approve submission by kepling
   * @param {object} data - Approval data
   * @returns {Promise<object>} Updated submission
   */
  async approveByKepling({ submissionId, keplingUserId, note }) {
    const submission = await prisma.submission.findUnique({
      where: { id: BigInt(submissionId) },
    });

    if (!submission) {
      const error = new Error('Submission tidak ditemukan');
      error.code = 'NOT_FOUND';
      throw error;
    }

    if (submission.status !== 'pending_kepling') {
      const error = new Error('Submission tidak dalam status pending_kepling');
      error.code = 'BAD_REQUEST';
      throw error;
    }

    // Check if kepling is assigned to this lingkungan
    const keplingAssignment = await prisma.lingkunganKepling.findFirst({
      where: {
        userId: BigInt(keplingUserId),
        lingkunganId: submission.lingkunganId,
        selesai: null,
      },
    });

    if (!keplingAssignment) {
      const error = new Error('Anda tidak memiliki akses ke submission ini');
      error.code = 'FORBIDDEN';
      throw error;
    }

    // Update submission and create approval record in transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create approval record
      await tx.submissionApproval.create({
        data: {
          submissionId: BigInt(submissionId),
          approvedBy: BigInt(keplingUserId),
          stage: 'kepling',
          status: 'approved',
          note: note || null,
        },
      });

      // Update submission status
      const updatedSubmission = await tx.submission.update({
        where: { id: BigInt(submissionId) },
        data: { status: 'pending_lurah' },
        include: {
          user: {
            include: { kependudukan: true },
          },
          lingkungan: {
            include: {
              keplings: {
                where: { selesai: null },
                include: { user: true },
              },
            },
          },
          documents: true,
          approvals: {
            include: { approver: true },
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      return updatedSubmission;
    });

    const activeLurahUserId = await this.getActiveLurahUserId();
    const notificationData = {
      submissionId: result.id.toString(),
      letterType: result.type,
      status: result.status,
    };

    await Promise.all([
      this.sendSubmissionNotification(
        activeLurahUserId,
        {
          title: 'Pengajuan Menunggu Persetujuan Lurah',
          body: `Pengajuan ${result.type} dari ${result.user.nama} telah disetujui Kepling dan menunggu persetujuan Anda.`,
          data: {
            ...notificationData,
            type: 'submission_approved_by_kepling_for_lurah',
          },
        },
        'to Lurah after Kepling approval',
      ),
      this.sendSubmissionNotification(
        result.userId,
        {
          title: 'Pengajuan Disetujui Kepling',
          body: `Pengajuan ${result.type} Anda telah disetujui Kepling dan diteruskan ke Lurah.`,
          data: {
            ...notificationData,
            type: 'submission_approved_by_kepling_for_warga',
          },
        },
        'to Warga after Kepling approval',
      ),
    ]);

    return result;
  }

  /**
   * Reject submission by kepling
   * @param {object} data - Rejection data
   * @returns {Promise<object>} Updated submission
   */
  async rejectByKepling({ submissionId, keplingUserId, reason, note }) {
    const submission = await prisma.submission.findUnique({
      where: { id: BigInt(submissionId) },
    });

    if (!submission) {
      const error = new Error('Submission tidak ditemukan');
      error.code = 'NOT_FOUND';
      throw error;
    }

    if (submission.status !== 'pending_kepling') {
      const error = new Error('Submission tidak dalam status pending_kepling');
      error.code = 'BAD_REQUEST';
      throw error;
    }

    // Check if kepling is assigned to this lingkungan
    const keplingAssignment = await prisma.lingkunganKepling.findFirst({
      where: {
        userId: BigInt(keplingUserId),
        lingkunganId: submission.lingkunganId,
        selesai: null,
      },
    });

    if (!keplingAssignment) {
      const error = new Error('Anda tidak memiliki akses ke submission ini');
      error.code = 'FORBIDDEN';
      throw error;
    }

    if (!reason) {
      const error = new Error('Alasan penolakan wajib diisi');
      error.code = 'BAD_REQUEST';
      throw error;
    }

    // Update submission and create approval record in transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create approval record
      await tx.submissionApproval.create({
        data: {
          submissionId: BigInt(submissionId),
          approvedBy: BigInt(keplingUserId),
          stage: 'kepling',
          status: 'rejected',
          note: note || reason,
        },
      });

      // Update submission status
      const updatedSubmission = await tx.submission.update({
        where: { id: BigInt(submissionId) },
        data: {
          status: 'rejected',
          rejectReason: reason,
        },
        include: {
          user: {
            include: { kependudukan: true },
          },
          lingkungan: {
            include: {
              keplings: {
                where: { selesai: null },
                include: { user: true },
              },
            },
          },
          documents: true,
          approvals: {
            include: { approver: true },
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      return updatedSubmission;
    });

    await this.sendSubmissionNotification(
      result.userId,
      {
        title: 'Pengajuan Ditolak Kepling',
        body: `Pengajuan ${result.type} Anda ditolak oleh Kepling. Alasan: ${reason}`,
        data: {
          submissionId: result.id.toString(),
          letterType: result.type,
          status: result.status,
          type: 'submission_rejected_by_kepling',
        },
      },
      'to Warga after Kepling rejection',
    );

    return result;
  }

  /**
   * Approve submission by lurah — triggers the 7-phase letter generation pipeline.
   * The Lurah provides a passphrase to decrypt their private key and sign the letter.
   * @param {object} data - Approval data
   * @returns {Promise<object>} Updated submission with issued letter
   */
  async approveByLurah({ submissionId, lurahUserId, passphrase, note, keterangan }) {
    // Delegate to letter service which handles:
    // - Validation (status must be pending_lurah)
    // - Auto letter number generation
    // - Template rendering → PDF generation
    // - Canonical data → hash → RSA signing
    // - XMP metadata embedding
    // - PDF save to disk
    // - DB transaction (approval record + issued letter + status → approved)
    const result = await letterService.issueLetter({
      submissionId,
      lurahUserId,
      passphrase,
      note,
      keterangan,
    });

    // Re-fetch the full submission for response formatting
    const updatedSubmission = await prisma.submission.findUnique({
      where: { id: BigInt(submissionId) },
      include: {
        user: {
          include: { kependudukan: true },
        },
        lingkungan: {
          include: {
            keplings: {
              where: { selesai: null },
              include: { user: true },
            },
          },
        },
        documents: true,
        approvals: {
          include: { approver: true },
          orderBy: { createdAt: 'asc' },
        },
        issuedLetter: true,
      },
    });

    await this.sendSubmissionNotification(
      updatedSubmission.userId,
      {
        title: 'Pengajuan Disetujui Lurah',
        body: `Pengajuan ${updatedSubmission.type} Anda telah disetujui Lurah dan surat telah diterbitkan.`,
        data: {
          submissionId: updatedSubmission.id.toString(),
          letterType: updatedSubmission.type,
          status: updatedSubmission.status,
          letterNumber: result.letterNumber,
          verificationCode: result.verificationCode,
          type: 'submission_approved_by_lurah',
        },
      },
      'to Warga after Lurah approval',
    );

    return {
      submission: updatedSubmission,
      letterResult: result,
    };
  }

  /**
   * Reject submission by lurah
   * @param {object} data - Rejection data
   * @returns {Promise<object>} Updated submission
   */
  async rejectByLurah({ submissionId, lurahUserId, reason, note }) {
    const submission = await prisma.submission.findUnique({
      where: { id: BigInt(submissionId) },
    });

    if (!submission) {
      const error = new Error('Submission tidak ditemukan');
      error.code = 'NOT_FOUND';
      throw error;
    }

    if (submission.status !== 'pending_lurah') {
      const error = new Error('Submission tidak dalam status pending_lurah');
      error.code = 'BAD_REQUEST';
      throw error;
    }

    if (!reason) {
      const error = new Error('Alasan penolakan wajib diisi');
      error.code = 'BAD_REQUEST';
      throw error;
    }

    // Update submission and create approval record in transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create approval record
      await tx.submissionApproval.create({
        data: {
          submissionId: BigInt(submissionId),
          approvedBy: BigInt(lurahUserId),
          stage: 'lurah',
          status: 'rejected',
          note: note || reason,
        },
      });

      // Update submission status
      const updatedSubmission = await tx.submission.update({
        where: { id: BigInt(submissionId) },
        data: {
          status: 'rejected',
          rejectReason: reason,
        },
        include: {
          user: {
            include: { kependudukan: true },
          },
          lingkungan: {
            include: {
              keplings: {
                where: { selesai: null },
                include: { user: true },
              },
            },
          },
          documents: true,
          approvals: {
            include: { approver: true },
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      return updatedSubmission;
    });

    await this.sendSubmissionNotification(
      result.userId,
      {
        title: 'Pengajuan Ditolak Lurah',
        body: `Pengajuan ${result.type} Anda ditolak oleh Lurah. Alasan: ${reason}`,
        data: {
          submissionId: result.id.toString(),
          letterType: result.type,
          status: result.status,
          type: 'submission_rejected_by_lurah',
        },
      },
      'to Warga after Lurah rejection',
    );

    return result;
  }

  /**
   * Delete submission (owner only, only if still pending_kepling)
   * @param {object} data - Delete data
   * @returns {Promise<boolean>} Success
   */
  async deleteSubmission({ submissionId, userId }) {
    const submission = await prisma.submission.findUnique({
      where: { id: BigInt(submissionId) },
    });

    if (!submission) {
      const error = new Error('Submission tidak ditemukan');
      error.code = 'NOT_FOUND';
      throw error;
    }

    if (submission.userId !== BigInt(userId)) {
      const error = new Error('Anda tidak memiliki akses ke submission ini');
      error.code = 'FORBIDDEN';
      throw error;
    }

    if (submission.status !== 'pending_kepling') {
      const error = new Error('Submission tidak dapat dihapus karena sudah dalam proses');
      error.code = 'BAD_REQUEST';
      throw error;
    }

    // Delete submission (documents will cascade delete)
    await prisma.submission.delete({
      where: { id: BigInt(submissionId) },
    });

    return true;
  }
}

export default new SubmissionService();
