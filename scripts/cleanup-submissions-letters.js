import dotenv from 'dotenv';
import { existsSync, readdirSync, rmSync } from 'fs';
import { join, resolve } from 'path';

dotenv.config({ path: process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development' });
dotenv.config();

const { default: prisma } = await import('../src/config/prisma.js');

const shouldConfirm = process.argv.includes('--confirm');
const shouldDeleteFiles = process.argv.includes('--delete-files');
const projectRoot = resolve(process.cwd());
const lettersDir = join(projectRoot, 'public', 'letters');
const draftDir = join(projectRoot, 'storage', 'letter-drafts');

if (!shouldConfirm) {
  console.log('DRY RUN: no data changed.');
  console.log('Run with --confirm to delete submission/letter data.');
  console.log('Add --delete-files to also remove generated PDFs and draft PDFs.');
}

const counts = {
  verificationLogs: await prisma.verificationLog.count(),
  signingSessions: await prisma.signingSession.count(),
  issuedLetters: await prisma.issuedLetter.count(),
  submissionApprovals: await prisma.submissionApproval.count(),
  submissionDocuments: await prisma.submissionDocument.count(),
  submissions: await prisma.submission.count(),
  letterCounters: await prisma.letterCounter.count(),
};

console.table(counts);

if (!shouldConfirm) {
  await prisma.$disconnect();
  process.exit(0);
}

await prisma.$transaction(async (tx) => {
  await tx.verificationLog.deleteMany();
  await tx.signingSession.deleteMany();
  await tx.issuedLetter.deleteMany();
  await tx.submissionApproval.deleteMany();
  await tx.submissionDocument.deleteMany();
  await tx.submission.deleteMany();
  await tx.letterCounter.deleteMany();
});

if (shouldDeleteFiles) {
  for (const dir of [lettersDir, draftDir]) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) {
      if (entry === '.gitkeep') continue;
      rmSync(join(dir, entry), { recursive: true, force: true });
    }
  }
}

console.log('Submission dan letter data berhasil dibersihkan.');
if (shouldDeleteFiles) {
  console.log('Generated PDF dan draft PDF juga dibersihkan.');
}

await prisma.$disconnect();
