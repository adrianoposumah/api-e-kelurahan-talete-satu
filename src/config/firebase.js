import admin from 'firebase-admin';
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

// Development: pakai file JSON
// Production: pakai env var (lebih aman)
if (!admin.apps.length) {
  let credential;
  if (process.env.FIREBASE_PRIVATE_KEY) {
    credential = admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    });
  } else {
    // Read serviceAccountKey.json
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const serviceAccountPath = path.join(__dirname, '../../serviceAccountKey.json');
    
    if (fs.existsSync(serviceAccountPath)) {
        const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
        credential = admin.credential.cert(serviceAccount);
    } else {
        console.warn("WARNING: Firebase credentials not found. Notifications will not work.");
    }
  }

  if (credential) {
    admin.initializeApp({ credential });
  }
}

export default admin;
