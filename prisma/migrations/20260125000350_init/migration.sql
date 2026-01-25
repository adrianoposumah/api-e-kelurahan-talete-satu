-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('warga', 'kepling', 'lurah', 'admin');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'inactive', 'banned');

-- CreateEnum
CREATE TYPE "JenisKelamin" AS ENUM ('L', 'P');

-- CreateEnum
CREATE TYPE "GolonganDarah" AS ENUM ('A', 'B', 'AB', 'O', '-');

-- CreateEnum
CREATE TYPE "StatusKawin" AS ENUM ('Belum Kawin', 'Kawin', 'Cerai Hidup', 'Cerai Mati');

-- CreateTable
CREATE TABLE "users" (
    "id" BIGSERIAL NOT NULL,
    "nik" CHAR(16),
    "nama" VARCHAR(100) NOT NULL,
    "no_hp" VARCHAR(20) NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'warga',
    "password" VARCHAR(255) NOT NULL,
    "is_validate" BOOLEAN NOT NULL DEFAULT false,
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_tokens" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "refresh_token" TEXT NOT NULL,
    "user_agent" VARCHAR(255),
    "ip_address" VARCHAR(50),
    "expired_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_kependudukan" (
    "nik" CHAR(16) NOT NULL,
    "nama" VARCHAR(100) NOT NULL,
    "tempat_lahir" VARCHAR(100) NOT NULL,
    "tanggal_lahir" DATE NOT NULL,
    "jenis_kelamin" "JenisKelamin" NOT NULL,
    "golongan_darah" "GolonganDarah",
    "alamat" TEXT NOT NULL,
    "rt" CHAR(3),
    "rw" CHAR(3),
    "kelurahan" VARCHAR(100) NOT NULL,
    "kecamatan" VARCHAR(100) NOT NULL,
    "kabupaten_kota" VARCHAR(100) NOT NULL,
    "provinsi" VARCHAR(100) NOT NULL,
    "status_kawin" "StatusKawin" NOT NULL,
    "agama" VARCHAR(50) NOT NULL,
    "pekerjaan" VARCHAR(100) NOT NULL,
    "kewarganegaraan" VARCHAR(10) NOT NULL DEFAULT 'WNI',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_kependudukan_pkey" PRIMARY KEY ("nik")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_nik_key" ON "users"("nik");

-- CreateIndex
CREATE UNIQUE INDEX "users_no_hp_key" ON "users"("no_hp");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_nik_fkey" FOREIGN KEY ("nik") REFERENCES "data_kependudukan"("nik") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_tokens" ADD CONSTRAINT "user_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
