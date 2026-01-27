import prisma from '../config/prisma.js';

/**
 * Submission Service - Handles submission workflow business logic
 */
class SubmissionService {
  /**
   * Create a new submission
   * @param {object} data - Submission data
   * @returns {Promise<object>} Created submission
   */
  async createSubmission({ userId, type, payload }) {
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

    // Create submission with status pending_kepling
    const submission = await prisma.submission.create({
      data: {
        userId: BigInt(userId),
        lingkunganId: lingkunganId,
        type,
        status: 'pending_kepling',
        payload: payload || null,
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

    return submission;
  }

  /**
   * Add document to submission
   * @param {object} data - Document data
   * @returns {Promise<object>} Created document
   */
  async addDocument({ submissionId, userId, filePath, fileType, description }) {
    const submission = await prisma.submission.findUnique({
      where: { id: BigInt(submissionId) },
    });

    if (!submission) {
      const error = new Error('Submission tidak ditemukan');
      error.code = 'NOT_FOUND';
      throw error;
    }

    // Only the owner can add documents
    if (submission.userId !== BigInt(userId)) {
      const error = new Error('Anda tidak memiliki akses ke submission ini');
      error.code = 'FORBIDDEN';
      throw error;
    }

    // Can only add documents when pending
    if (!['pending_kepling', 'pending_lurah'].includes(submission.status)) {
      const error = new Error('Tidak dapat menambah dokumen pada submission yang sudah diproses');
      error.code = 'BAD_REQUEST';
      throw error;
    }

    const document = await prisma.submissionDocument.create({
      data: {
        submissionId: BigInt(submissionId),
        filePath,
        fileType: fileType || null,
        description: description || null,
      },
    });

    return document;
  }

  /**
   * Get submissions for a citizen (warga)
   * @param {object} options - Query options
   * @returns {Promise<object>} Submissions and pagination
   */
  async getSubmissionsByUser({ userId, page = 1, limit = 10, status, type }) {
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {
      userId: BigInt(userId),
    };
    if (status) where.status = status;
    if (type) where.type = type;

    const [submissions, total] = await Promise.all([
      prisma.submission.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
        include: {
          user: true,
          lingkungan: true,
          documents: true,
          approvals: {
            include: { approver: true },
            orderBy: { createdAt: 'asc' },
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
   * Get submissions for kepling's lingkungan
   * @param {object} options - Query options
   * @returns {Promise<object>} Submissions and pagination
   */
  async getSubmissionsForKepling({ keplingUserId, page = 1, limit = 10, status, type }) {
    const skip = (parseInt(page) - 1) * parseInt(limit);

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
    };
    if (status) where.status = status;
    if (type) where.type = type;

    const [submissions, total] = await Promise.all([
      prisma.submission.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            include: { kependudukan: true },
          },
          lingkungan: true,
          documents: true,
          approvals: {
            include: { approver: true },
            orderBy: { createdAt: 'asc' },
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
   * Get all submissions for lurah
   * @param {object} options - Query options
   * @returns {Promise<object>} Submissions and pagination
   */
  async getSubmissionsForLurah({ page = 1, limit = 10, status, type }) {
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (status) where.status = status;
    if (type) where.type = type;

    const [submissions, total] = await Promise.all([
      prisma.submission.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
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
   * Verify document (kepling only)
   * @param {object} data - Verification data
   * @returns {Promise<object>} Updated document
   */
  async verifyDocument({ documentId, keplingUserId, verified }) {
    const document = await prisma.submissionDocument.findUnique({
      where: { id: BigInt(documentId) },
      include: {
        submission: {
          include: { lingkungan: true },
        },
      },
    });

    if (!document) {
      const error = new Error('Dokumen tidak ditemukan');
      error.code = 'NOT_FOUND';
      throw error;
    }

    // Check if kepling is assigned to this lingkungan
    const keplingAssignment = await prisma.lingkunganKepling.findFirst({
      where: {
        userId: BigInt(keplingUserId),
        lingkunganId: document.submission.lingkunganId,
        selesai: null,
      },
    });

    if (!keplingAssignment) {
      const error = new Error('Anda tidak memiliki akses ke dokumen ini');
      error.code = 'FORBIDDEN';
      throw error;
    }

    const updatedDocument = await prisma.submissionDocument.update({
      where: { id: BigInt(documentId) },
      data: { verified },
    });

    return updatedDocument;
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

    return result;
  }

  /**
   * Approve submission by lurah
   * @param {object} data - Approval data
   * @returns {Promise<object>} Updated submission
   */
  async approveByLurah({ submissionId, lurahUserId, note }) {
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

    // Update submission and create approval record in transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create approval record
      await tx.submissionApproval.create({
        data: {
          submissionId: BigInt(submissionId),
          approvedBy: BigInt(lurahUserId),
          stage: 'lurah',
          status: 'approved',
          note: note || null,
        },
      });

      // Update submission status
      const updatedSubmission = await tx.submission.update({
        where: { id: BigInt(submissionId) },
        data: { status: 'approved' },
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

    return result;
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

    return result;
  }

  /**
   * Issue submission (mark as issued) - Admin only
   * @param {object} data - Issue data
   * @returns {Promise<object>} Updated submission
   */
  async issueSubmission({ submissionId }) {
    const submission = await prisma.submission.findUnique({
      where: { id: BigInt(submissionId) },
    });

    if (!submission) {
      const error = new Error('Submission tidak ditemukan');
      error.code = 'NOT_FOUND';
      throw error;
    }

    if (submission.status !== 'approved') {
      const error = new Error('Submission belum disetujui');
      error.code = 'BAD_REQUEST';
      throw error;
    }

    const updatedSubmission = await prisma.submission.update({
      where: { id: BigInt(submissionId) },
      data: { status: 'issued' },
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
