/*
  Warnings:

  - You are about to drop the column `lurah_user_id` on the `lurah_keys` table. All the data in the column will be lost.
  - Added the required column `lurah_profile_id` to the `lurah_keys` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "lurah_keys_lurah_user_id_key";

-- AlterTable
ALTER TABLE "lurah_keys" DROP COLUMN "lurah_user_id",
ADD COLUMN     "lurah_profile_id" BIGINT NOT NULL;

-- CreateTable
CREATE TABLE "lurah_profiles" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "nip" VARCHAR(18) NOT NULL,
    "nama_lengkap" VARCHAR(100) NOT NULL,
    "jabatan" VARCHAR(100) NOT NULL DEFAULT 'Lurah',
    "pangkat" VARCHAR(100),
    "mulai_menjabat" DATE NOT NULL,
    "akhir_menjabat" DATE,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lurah_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lurah_profiles_user_id_key" ON "lurah_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "lurah_profiles_nip_key" ON "lurah_profiles"("nip");

-- AddForeignKey
ALTER TABLE "lurah_profiles" ADD CONSTRAINT "lurah_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lurah_keys" ADD CONSTRAINT "lurah_keys_lurah_profile_id_fkey" FOREIGN KEY ("lurah_profile_id") REFERENCES "lurah_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
