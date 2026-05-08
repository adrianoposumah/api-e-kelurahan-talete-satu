/**
 * Shared formatting functions for API responses
 */

/**
 * Format user object for API response (excludes password)
 * @param {object} user - User object from database
 * @returns {object} Formatted user object
 */
export const formatUserResponse = (user) => ({
  id: user.id.toString(),
  nik: user.nik,
  nama: user.nama,
  no_hp: user.noHp,
  role: user.role,
  is_validate: user.isValidate,
  status: user.status,
  created_at: user.createdAt,
  updated_at: user.updatedAt,
});

/**
 * Format user object with kependudukan data for API response
 * @param {object} user - User object from database with kependudukan relation
 * @returns {object} Formatted user object with kependudukan
 */
export const formatUserWithKependudukanResponse = (user) => ({
  ...formatUserResponse(user),
  kependudukan: user.isValidate && user.kependudukan ? formatKependudukanResponse(user.kependudukan) : undefined,
});

/**
 * Format kependudukan object for API response
 * @param {object} kependudukan - Kependudukan object from database
 * @returns {object} Formatted kependudukan object
 */
export const formatKependudukanResponse = (kependudukan) => ({
  nik: kependudukan.nik,
  nama: kependudukan.nama,
  tempat_lahir: kependudukan.tempatLahir,
  tanggal_lahir: kependudukan.tanggalLahir,
  jenis_kelamin: kependudukan.jenisKelamin,
  golongan_darah: kependudukan.golonganDarah,
  alamat: kependudukan.alamat,
  rt: kependudukan.rt,
  rw: kependudukan.rw,
  kelurahan: kependudukan.kelurahan,
  kecamatan: kependudukan.kecamatan,
  kabupaten_kota: kependudukan.kabupatenKota,
  provinsi: kependudukan.provinsi,
  status_kawin: kependudukan.statusKawin,
  agama: kependudukan.agama,
  pekerjaan: kependudukan.pekerjaan,
  kewarganegaraan: kependudukan.kewarganegaraan,
  lingkungan_id: kependudukan.lingkunganId?.toString() || null,
});

/**
 * Format kependudukan object for management endpoints
 * @param {object} kependudukan - Kependudukan object with relations
 * @returns {object} Formatted kependudukan management object
 */
export const formatKependudukanManagementResponse = (kependudukan) => ({
  ...formatKependudukanResponse(kependudukan),
  lingkungan_id: kependudukan.lingkunganId?.toString() || null,
  created_at: kependudukan.createdAt,
  updated_at: kependudukan.updatedAt,
  lingkungan: kependudukan.lingkungan
    ? {
        id: kependudukan.lingkungan.id.toString(),
        nama: kependudukan.lingkungan.nama,
        kode: kependudukan.lingkungan.kode,
      }
    : undefined,
  user: kependudukan.user
    ? {
        id: kependudukan.user.id.toString(),
        nama: kependudukan.user.nama,
        role: kependudukan.user.role,
        is_validate: kependudukan.user.isValidate,
      }
    : undefined,
});

/**
 * Format validate request object for API response
 * @param {object} request - ValidateRequest object from database
 * @returns {object} Formatted validate request object
 */
export const formatValidateRequestResponse = (request) => ({
  id: request.id.toString(),
  user_id: request.userId.toString(),
  nik: request.nik,
  status: request.status,
  admin_notes: request.adminNotes,
  processed_by: request.processedBy?.toString() || null,
  processed_at: request.processedAt,
  created_at: request.createdAt,
  updated_at: request.updatedAt,
  user: request.user
    ? {
        id: request.user.id.toString(),
        nama: request.user.nama,
        no_hp: request.user.noHp,
      }
    : undefined,
  kependudukan: request.kependudukan ? formatKependudukanResponse(request.kependudukan) : undefined,
  admin: request.admin
    ? {
        id: request.admin.id.toString(),
        nama: request.admin.nama,
      }
    : undefined,
});

/**
 * Format lingkungan object for API response
 * @param {object} lingkungan - Lingkungan object from database
 * @returns {object} Formatted lingkungan object
 */
export const formatLingkunganResponse = (lingkungan) => ({
  id: lingkungan.id.toString(),
  nama: lingkungan.nama,
  kode: lingkungan.kode,
  created_at: lingkungan.createdAt,
  updated_at: lingkungan.updatedAt,
});

/**
 * Format lingkungan kepling assignment object for API response
 * @param {object} assignment - LingkunganKepling object from database
 * @returns {object} Formatted assignment object
 */
export const formatLingkunganKeplingResponse = (assignment) => ({
  id: assignment.id.toString(),
  lingkungan_id: assignment.lingkunganId.toString(),
  user_id: assignment.userId.toString(),
  mulai: assignment.mulai,
  selesai: assignment.selesai,
  created_at: assignment.createdAt,
  updated_at: assignment.updatedAt,
  lingkungan: assignment.lingkungan ? formatLingkunganResponse(assignment.lingkungan) : undefined,
  user: assignment.user ? formatUserResponse(assignment.user) : undefined,
});

/**
 * Format lingkungan with keplings for API response
 * @param {object} lingkungan - Lingkungan object with keplings relation
 * @returns {object} Formatted lingkungan object with keplings
 */
export const formatLingkunganWithKeplingsResponse = (lingkungan) => ({
  ...formatLingkunganResponse(lingkungan),
  keplings: lingkungan.keplings
    ? lingkungan.keplings.map((k) => ({
        id: k.id.toString(),
        lingkungan_id: k.lingkunganId.toString(),
        user_id: k.userId.toString(),
        mulai: k.mulai,
        selesai: k.selesai,
        created_at: k.createdAt,
        updated_at: k.updatedAt,
        user: k.user ? formatUserResponse(k.user) : undefined,
      }))
    : [],
});

// ==================== LURAH PROFILE FORMATTERS ====================

/**
 * Format Lurah profile object for API response
 * @param {object} profile - LurahProfile object from database
 * @returns {object} Formatted Lurah profile object
 */
export const formatLurahProfileResponse = (profile) => ({
  id: profile.id.toString(),
  user_id: profile.userId.toString(),
  nip: profile.nip,
  nama_lengkap: profile.namaLengkap,
  jabatan: profile.jabatan,
  pangkat: profile.pangkat,
  mulai_menjabat: profile.mulaiMenjabat,
  akhir_menjabat: profile.akhirMenjabat,
  is_active: profile.isActive,
  created_at: profile.createdAt,
  updated_at: profile.updatedAt,
  user: profile.user ? formatUserResponse(profile.user) : undefined,
});

/**
 * Format Sekertaris profile object for API response
 * @param {object} profile - SekertarisProfile object from database
 * @returns {object} Formatted Sekertaris profile object
 */
export const formatSekertarisProfileResponse = (profile) => ({
  id: profile.id.toString(),
  user_id: profile.userId.toString(),
  nip: profile.nip,
  nama_lengkap: profile.namaLengkap,
  jabatan: profile.jabatan,
  pangkat: profile.pangkat,
  mulai_menjabat: profile.mulaiMenjabat,
  akhir_menjabat: profile.akhirMenjabat,
  is_active: profile.isActive,
  created_at: profile.createdAt,
  updated_at: profile.updatedAt,
  user: profile.user ? formatUserResponse(profile.user) : undefined,
});

// ==================== SUBMISSION FORMATTERS ====================

/**
 * Format submission document object for API response
 * @param {object} document - SubmissionDocument object from database
 * @returns {object} Formatted document object
 */
export const formatSubmissionDocumentResponse = (document) => ({
  id: document.id.toString(),
  submission_id: document.submissionId.toString(),
  file_path: document.filePath,
  file_type: document.fileType,
  description: document.description,
  verified: document.verified,
  created_at: document.createdAt,
});

/**
 * Format submission approval object for API response
 * @param {object} approval - SubmissionApproval object from database
 * @returns {object} Formatted approval object
 */
export const formatSubmissionApprovalResponse = (approval) => ({
  id: approval.id.toString(),
  submission_id: approval.submissionId.toString(),
  approved_by: approval.approvedBy.toString(),
  stage: approval.stage,
  status: approval.status,
  note: approval.note,
  created_at: approval.createdAt,
  approver: approval.approver
    ? {
        id: approval.approver.id.toString(),
        nama: approval.approver.nama,
        role: approval.approver.role,
      }
    : undefined,
});

/**
 * Format submission list item for citizen endpoint
 * @param {object} submission - Submission object from database
 * @returns {object} Minimal formatted submission object
 */
export const formatSubmissionByUserResponse = (submission) => ({
  id: submission.id.toString(),
  user_id: submission.userId.toString(),
  name: submission.user?.nama || null,
  lingkungan_id: submission.lingkunganId.toString(),
  type: submission.type,
  status: submission.status,
  created_at: submission.createdAt,
  updated_at: submission.updatedAt,
});

/**
 * Format submission object for API response
 * @param {object} submission - Submission object from database
 * @returns {object} Formatted submission object
 */
export const formatSubmissionResponse = (submission, options = {}) => {
  const baseUrl = options.baseUrl || '';

  const buildDocumentUrl = (submissionId, documentId, download = false) => {
    const relativeUrl = `/v1/submissions/${submissionId}/documents/${documentId}${download ? '?download=true' : ''}`;

    if (!baseUrl) {
      return relativeUrl;
    }

    return new URL(relativeUrl, baseUrl).toString();
  };

  return {
    id: submission.id.toString(),
    user_id: submission.userId.toString(),
    name: submission.user?.nama || null,
    lingkungan_id: submission.lingkunganId.toString(),
    type: submission.type,
    status: submission.status,
    payload: submission.payload,
    reject_reason: submission.rejectReason,
    created_at: submission.createdAt,
    updated_at: submission.updatedAt,
    user: submission.user
      ? {
          id: submission.user.id.toString(),
          nik: submission.user.nik,
          nama: submission.user.nama,
          no_hp: submission.user.noHp,
          kependudukan: submission.user.kependudukan ? formatKependudukanResponse(submission.user.kependudukan) : undefined,
        }
      : undefined,
    lingkungan: submission.lingkungan
      ? {
          ...formatLingkunganResponse(submission.lingkungan),
          keplings: submission.lingkungan.keplings
            ? submission.lingkungan.keplings.map((k) => ({
                id: k.id.toString(),
                user_id: k.userId.toString(),
                user: k.user
                  ? {
                      id: k.user.id.toString(),
                      nama: k.user.nama,
                      no_hp: k.user.noHp,
                    }
                  : undefined,
              }))
            : undefined,
        }
      : undefined,
    documents: submission.documents
      ? submission.documents.map((document) => {
          const submissionId = submission.id.toString();
          const documentId = document.id.toString();
          const viewUrl = buildDocumentUrl(submissionId, documentId, false);
          const downloadUrl = buildDocumentUrl(submissionId, documentId, true);

          return {
            ...formatSubmissionDocumentResponse(document),
            file_path: viewUrl,
            view_url: viewUrl,
            download_url: downloadUrl,
          };
        })
      : [],
    approvals: submission.approvals ? submission.approvals.map(formatSubmissionApprovalResponse) : [],
  };
};

// ==================== ISSUED LETTER FORMATTERS ====================

/**
 * Format issued letter object for API response
 * @param {object} letter - IssuedLetter object from database
 * @returns {object} Formatted issued letter object
 */
export const formatIssuedLetterResponse = (letter) => ({
  id: letter.id.toString(),
  submission_id: letter.submissionId.toString(),
  letter_number: letter.letterNumber,
  verification_code: letter.verificationCode,
  type: letter.type,
  keterangan: letter.keterangan,
  pdf_path: letter.pdfPath,
  signed_by: letter.signedBy.toString(),
  signature_key_id: letter.signatureKeyId?.toString() || null,
  issued_at: letter.issuedAt,
  expires_at: letter.expiresAt,
  is_revoked: letter.isRevoked,
  revoked_at: letter.revokedAt,
  revoked_reason: letter.revokedReason,
  created_at: letter.createdAt,
  submission: letter.submission
    ? {
        id: letter.submission.id.toString(),
        type: letter.submission.type,
        user: letter.submission.user
          ? {
              id: letter.submission.user.id.toString(),
              nama: letter.submission.user.kependudukan?.nama || letter.submission.user.nama,
              nik: letter.submission.user.nik,
            }
          : undefined,
        lingkungan: letter.submission.lingkungan
          ? {
              id: letter.submission.lingkungan.id.toString(),
              nama: letter.submission.lingkungan.nama,
            }
          : undefined,
      }
    : undefined,
});
