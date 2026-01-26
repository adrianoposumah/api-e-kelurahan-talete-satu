-- AlterTable
ALTER TABLE "data_kependudukan" ADD COLUMN     "lingkungan_id" BIGINT;

-- CreateTable
CREATE TABLE "lingkungan" (
    "id" BIGSERIAL NOT NULL,
    "nama" VARCHAR(100) NOT NULL,
    "kode" VARCHAR(10),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lingkungan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lingkungan_kepling" (
    "id" BIGSERIAL NOT NULL,
    "lingkungan_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "mulai" DATE NOT NULL,
    "selesai" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lingkungan_kepling_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lingkungan_kode_key" ON "lingkungan"("kode");

-- AddForeignKey
ALTER TABLE "lingkungan_kepling" ADD CONSTRAINT "lingkungan_kepling_lingkungan_id_fkey" FOREIGN KEY ("lingkungan_id") REFERENCES "lingkungan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lingkungan_kepling" ADD CONSTRAINT "lingkungan_kepling_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_kependudukan" ADD CONSTRAINT "data_kependudukan_lingkungan_id_fkey" FOREIGN KEY ("lingkungan_id") REFERENCES "lingkungan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
