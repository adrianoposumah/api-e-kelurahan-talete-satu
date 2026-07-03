-- CreateEnum
CREATE TYPE "LetterReservationStatus" AS ENUM ('RESERVED', 'ISSUED', 'RELEASED');

-- CreateTable
CREATE TABLE "letter_reservations" (
    "id" BIGSERIAL NOT NULL,
    "year" INTEGER NOT NULL,
    "sequence" INTEGER NOT NULL,
    "letter_number" VARCHAR(100) NOT NULL,
    "verification_code" VARCHAR(50) NOT NULL,
    "status" "LetterReservationStatus" NOT NULL DEFAULT 'RESERVED',
    "submission_id" BIGINT,
    "reserved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "letter_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "letter_reservations_submission_id_key" ON "letter_reservations"("submission_id");

-- CreateIndex
CREATE INDEX "letter_reservations_status_year_sequence_idx" ON "letter_reservations"("status", "year", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "letter_reservations_year_sequence_key" ON "letter_reservations"("year", "sequence");

-- AddForeignKey
ALTER TABLE "letter_reservations" ADD CONSTRAINT "letter_reservations_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
