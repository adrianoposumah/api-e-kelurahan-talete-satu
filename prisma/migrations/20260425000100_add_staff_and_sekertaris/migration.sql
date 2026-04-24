-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'staff';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'sekertaris';

-- CreateTable
CREATE TABLE "sekertaris_profiles" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "nip" VARCHAR(18) NOT NULL,
    "nama_lengkap" VARCHAR(100) NOT NULL,
    "jabatan" VARCHAR(100) NOT NULL DEFAULT 'Sekertaris',
    "pangkat" VARCHAR(100),
    "mulai_menjabat" DATE NOT NULL,
    "akhir_menjabat" DATE,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sekertaris_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sekertaris_profiles_user_id_key" ON "sekertaris_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "sekertaris_profiles_nip_key" ON "sekertaris_profiles"("nip");

-- AddForeignKey
ALTER TABLE "sekertaris_profiles"
ADD CONSTRAINT "sekertaris_profiles_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
