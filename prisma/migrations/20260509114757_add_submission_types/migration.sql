/*
  Warnings:

  - The values [kematian,kelakuan_baik] on the enum `SubmissionType` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "SubmissionType_new" AS ENUM ('domisili', 'usaha', 'keramaian', 'belum_menikah', 'keterangan_hilang', 'penghasilan', 'skck', 'tidak_mampu');
ALTER TABLE "submissions" ALTER COLUMN "type" TYPE "SubmissionType_new" USING ("type"::text::"SubmissionType_new");
ALTER TABLE "issued_letters" ALTER COLUMN "type" TYPE "SubmissionType_new" USING ("type"::text::"SubmissionType_new");
ALTER TYPE "SubmissionType" RENAME TO "SubmissionType_old";
ALTER TYPE "SubmissionType_new" RENAME TO "SubmissionType";
DROP TYPE "public"."SubmissionType_old";
COMMIT;
