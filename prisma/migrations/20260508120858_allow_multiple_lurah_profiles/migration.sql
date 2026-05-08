-- DropIndex
DROP INDEX "lurah_profiles_user_id_key";

-- CreateIndex
CREATE INDEX "lurah_profiles_user_id_idx" ON "lurah_profiles"("user_id");
