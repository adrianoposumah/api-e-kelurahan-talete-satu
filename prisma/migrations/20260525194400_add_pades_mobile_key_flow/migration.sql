-- v2.0 mobile-key/PAdES signing support.

CREATE TYPE "SigningSessionStatus" AS ENUM ('PENDING', 'COMPLETED', 'EXPIRED', 'REJECTED');

ALTER TABLE "lurah_keys"
  ALTER COLUMN "encrypted_private_key" DROP NOT NULL,
  ADD COLUMN "certificate_pem" TEXT,
  ADD COLUMN "serial_number" VARCHAR(64),
  ADD COLUMN "fingerprint" VARCHAR(128),
  ADD COLUMN "device_label" VARCHAR(255),
  ADD COLUMN "enrolled_at" TIMESTAMP(3),
  ADD COLUMN "expires_at" TIMESTAMP(3);

CREATE UNIQUE INDEX "lurah_keys_serial_number_key" ON "lurah_keys"("serial_number");
CREATE UNIQUE INDEX "lurah_keys_fingerprint_key" ON "lurah_keys"("fingerprint");
CREATE INDEX "lurah_keys_fingerprint_idx" ON "lurah_keys"("fingerprint");

CREATE TABLE "signing_sessions" (
  "id" BIGSERIAL NOT NULL,
  "submission_id" BIGINT NOT NULL,
  "lurah_profile_id" BIGINT NOT NULL,
  "key_id" BIGINT NOT NULL,
  "bytes_to_sign_base64" TEXT NOT NULL,
  "pdf_draft_path" VARCHAR(255) NOT NULL,
  "letter_number" VARCHAR(100) NOT NULL,
  "verification_code" VARCHAR(50) NOT NULL,
  "issued_date" TIMESTAMP(3) NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "status" "SigningSessionStatus" NOT NULL DEFAULT 'PENDING',
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "signing_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "signing_sessions_submission_id_idx" ON "signing_sessions"("submission_id");
CREATE INDEX "signing_sessions_key_id_idx" ON "signing_sessions"("key_id");
CREATE INDEX "signing_sessions_expires_at_status_idx" ON "signing_sessions"("expires_at", "status");

ALTER TABLE "signing_sessions"
  ADD CONSTRAINT "signing_sessions_submission_id_fkey"
  FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "signing_sessions"
  ADD CONSTRAINT "signing_sessions_lurah_profile_id_fkey"
  FOREIGN KEY ("lurah_profile_id") REFERENCES "lurah_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "signing_sessions"
  ADD CONSTRAINT "signing_sessions_key_id_fkey"
  FOREIGN KEY ("key_id") REFERENCES "lurah_keys"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "issued_letters"
  ADD COLUMN "public_id" TEXT,
  ADD COLUMN "signed_at" TIMESTAMP(3);

CREATE UNIQUE INDEX "issued_letters_public_id_key" ON "issued_letters"("public_id");

ALTER TABLE "issued_letters"
  DROP COLUMN "canonical_data",
  DROP COLUMN "canonical_hash",
  DROP COLUMN "signature";

ALTER TABLE "issued_letters"
  ADD CONSTRAINT "issued_letters_signature_key_id_fkey"
  FOREIGN KEY ("signature_key_id") REFERENCES "lurah_keys"("id") ON DELETE SET NULL ON UPDATE CASCADE;
