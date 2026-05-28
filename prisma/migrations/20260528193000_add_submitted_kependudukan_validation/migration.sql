-- Allow validation requests to carry new kependudukan data before it exists
-- in data_kependudukan. The FK remains valid because nik can be null until
-- an admin approves the submitted data.
CREATE TYPE "ValidateRequestType" AS ENUM ('existing_data', 'submitted_data');

ALTER TABLE "validate_requests"
  ALTER COLUMN "nik" DROP NOT NULL,
  ADD COLUMN "request_type" "ValidateRequestType" NOT NULL DEFAULT 'existing_data',
  ADD COLUMN "submitted_data" JSONB;
