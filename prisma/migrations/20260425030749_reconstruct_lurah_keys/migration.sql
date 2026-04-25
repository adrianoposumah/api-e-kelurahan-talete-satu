/*
  Warnings:

  - You are about to drop the column `is_active` on the `lurah_keys` table. All the data in the column will be lost.
  - You are about to drop the column `private_key` on the `lurah_keys` table. All the data in the column will be lost.
  - Added the required column `encrypted_private_key` to the `lurah_keys` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "KeyStatus" AS ENUM ('ACTIVE', 'REVOKED', 'INACTIVE');

-- Delete existing incompatible records
DELETE FROM "lurah_keys";

-- AlterTable
ALTER TABLE "lurah_keys" DROP COLUMN "is_active",
DROP COLUMN "private_key",
ADD COLUMN     "deactivate_reason" TEXT,
ADD COLUMN     "deactivated_at" TIMESTAMP(3),
ADD COLUMN     "deactivated_by_id" BIGINT,
ADD COLUMN     "encrypted_private_key" TEXT NOT NULL,
ADD COLUMN     "status" "KeyStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateIndex
CREATE INDEX "lurah_keys_status_idx" ON "lurah_keys"("status");

-- CreateIndex
CREATE INDEX "lurah_keys_lurah_profile_id_idx" ON "lurah_keys"("lurah_profile_id");
