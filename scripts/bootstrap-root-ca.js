import dotenv from 'dotenv';

dotenv.config({ path: process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development' });
dotenv.config();

const { default: caService } = await import('../src/services/ca.service.js');

try {
  const result = caService.bootstrapRootCa();
  console.log('Root CA berhasil dibuat.');
  console.log(`Certificate bytes: ${Buffer.byteLength(result.certificatePem, 'utf8')}`);
  console.log('Backup root-ca-key.pem ke storage offline dan jangan commit file secure-storage/.');
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
