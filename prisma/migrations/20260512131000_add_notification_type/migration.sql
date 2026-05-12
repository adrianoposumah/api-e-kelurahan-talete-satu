-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('submission', 'announcement', 'other');

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN "type" "NotificationType" NOT NULL DEFAULT 'other';

-- CreateIndex
CREATE INDEX "notifications_type_idx" ON "notifications"("type");
