-- DropIndex
DROP INDEX "lurah_profiles_nip_key";

-- CreateIndex
CREATE INDEX "lurah_profiles_nip_idx" ON "lurah_profiles"("nip");
