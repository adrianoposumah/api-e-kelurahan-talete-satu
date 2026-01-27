-- CreateEnum
CREATE TYPE "SubmissionType" AS ENUM ('domisili', 'usaha', 'kematian', 'kelakuan_baik', 'keramaian');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('pending_kepling', 'pending_lurah', 'rejected', 'approved', 'issued');

-- CreateEnum
CREATE TYPE "ApprovalStage" AS ENUM ('kepling', 'lurah');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('approved', 'rejected');

-- CreateTable
CREATE TABLE "submissions" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "lingkungan_id" BIGINT NOT NULL,
    "type" "SubmissionType" NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'pending_kepling',
    "payload" JSON,
    "reject_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submission_documents" (
    "id" BIGSERIAL NOT NULL,
    "submission_id" BIGINT NOT NULL,
    "file_path" VARCHAR(255) NOT NULL,
    "file_type" VARCHAR(50),
    "description" VARCHAR(100),
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "submission_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submission_approvals" (
    "id" BIGSERIAL NOT NULL,
    "submission_id" BIGINT NOT NULL,
    "approved_by" BIGINT NOT NULL,
    "stage" "ApprovalStage" NOT NULL,
    "status" "ApprovalStatus" NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "submission_approvals_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_lingkungan_id_fkey" FOREIGN KEY ("lingkungan_id") REFERENCES "lingkungan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_documents" ADD CONSTRAINT "submission_documents_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_approvals" ADD CONSTRAINT "submission_approvals_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_approvals" ADD CONSTRAINT "submission_approvals_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
