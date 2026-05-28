-- DropForeignKey
ALTER TABLE "validate_requests" DROP CONSTRAINT "validate_requests_nik_fkey";

-- AddForeignKey
ALTER TABLE "validate_requests" ADD CONSTRAINT "validate_requests_nik_fkey" FOREIGN KEY ("nik") REFERENCES "data_kependudukan"("nik") ON DELETE SET NULL ON UPDATE CASCADE;
