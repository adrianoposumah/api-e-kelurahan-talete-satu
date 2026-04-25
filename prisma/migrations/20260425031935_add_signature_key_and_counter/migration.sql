-- AlterTable
ALTER TABLE "issued_letters" ADD COLUMN     "signature_key_id" BIGINT;

-- CreateTable
CREATE TABLE "letter_counters" (
    "letter_type" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "letter_counters_pkey" PRIMARY KEY ("letter_type","year")
);

-- CreateIndex
CREATE INDEX "issued_letters_signature_key_id_idx" ON "issued_letters"("signature_key_id");
