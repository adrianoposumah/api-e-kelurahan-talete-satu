-- CreateTable
CREATE TABLE "verification_logs" (
    "id" BIGSERIAL NOT NULL,
    "verification_code" TEXT,
    "decision_status" TEXT NOT NULL,
    "server_pass" BOOLEAN NOT NULL,
    "crypto_pass" BOOLEAN NOT NULL,
    "body_pass" BOOLEAN NOT NULL,
    "attempted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "verification_logs_verification_code_idx" ON "verification_logs"("verification_code");

-- CreateIndex
CREATE INDEX "verification_logs_attempted_at_idx" ON "verification_logs"("attempted_at");
