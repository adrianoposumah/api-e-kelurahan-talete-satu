-- CreateTable
CREATE TABLE "lurah_keys" (
    "id" BIGSERIAL NOT NULL,
    "lurah_user_id" BIGINT NOT NULL,
    "public_key" TEXT NOT NULL,
    "private_key" TEXT NOT NULL,
    "algorithm" VARCHAR(50) NOT NULL DEFAULT 'RSA-SHA256',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lurah_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issued_letters" (
    "id" BIGSERIAL NOT NULL,
    "submission_id" BIGINT NOT NULL,
    "letter_number" VARCHAR(100) NOT NULL,
    "verification_code" VARCHAR(50) NOT NULL,
    "type" "SubmissionType" NOT NULL,
    "canonical_data" TEXT NOT NULL,
    "canonical_hash" VARCHAR(64) NOT NULL,
    "signature" TEXT NOT NULL,
    "signed_by" BIGINT NOT NULL,
    "pdf_path" VARCHAR(255) NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    "is_revoked" BOOLEAN NOT NULL DEFAULT false,
    "revoked_at" TIMESTAMP(3),
    "revoked_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "issued_letters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lurah_keys_lurah_user_id_key" ON "lurah_keys"("lurah_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "issued_letters_submission_id_key" ON "issued_letters"("submission_id");

-- CreateIndex
CREATE UNIQUE INDEX "issued_letters_letter_number_key" ON "issued_letters"("letter_number");

-- CreateIndex
CREATE UNIQUE INDEX "issued_letters_verification_code_key" ON "issued_letters"("verification_code");

-- AddForeignKey
ALTER TABLE "issued_letters" ADD CONSTRAINT "issued_letters_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
