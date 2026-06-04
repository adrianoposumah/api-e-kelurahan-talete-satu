-- CreateEnum
CREATE TYPE "ArsipDirection" AS ENUM ('masuk', 'keluar');

-- CreateEnum
CREATE TYPE "ArsipSifat" AS ENUM ('biasa', 'penting', 'segera', 'rahasia');

-- CreateTable
CREATE TABLE "arsip_surat" (
    "id" BIGSERIAL NOT NULL,
    "direction" "ArsipDirection" NOT NULL,
    "nomor_surat" VARCHAR(100) NOT NULL,
    "tanggal_surat" DATE NOT NULL,
    "tanggal_diterima" DATE,
    "pihak" VARCHAR(150) NOT NULL,
    "perihal" VARCHAR(255) NOT NULL,
    "sifat" "ArsipSifat" NOT NULL DEFAULT 'biasa',
    "keterangan" TEXT,
    "file_path" VARCHAR(255),
    "file_type" VARCHAR(50),
    "created_by" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "arsip_surat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "arsip_surat_direction_idx" ON "arsip_surat"("direction");

-- CreateIndex
CREATE INDEX "arsip_surat_tanggal_surat_idx" ON "arsip_surat"("tanggal_surat");

-- CreateIndex
CREATE INDEX "arsip_surat_created_by_idx" ON "arsip_surat"("created_by");

-- AddForeignKey
ALTER TABLE "arsip_surat" ADD CONSTRAINT "arsip_surat_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
