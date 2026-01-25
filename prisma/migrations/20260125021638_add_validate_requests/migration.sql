-- CreateEnum
CREATE TYPE "ValidateRequestStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "validate_requests" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "nik" CHAR(16) NOT NULL,
    "status" "ValidateRequestStatus" NOT NULL DEFAULT 'pending',
    "admin_notes" TEXT,
    "processed_by" BIGINT,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "validate_requests_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "validate_requests" ADD CONSTRAINT "validate_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "validate_requests" ADD CONSTRAINT "validate_requests_processed_by_fkey" FOREIGN KEY ("processed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "validate_requests" ADD CONSTRAINT "validate_requests_nik_fkey" FOREIGN KEY ("nik") REFERENCES "data_kependudukan"("nik") ON DELETE RESTRICT ON UPDATE CASCADE;
