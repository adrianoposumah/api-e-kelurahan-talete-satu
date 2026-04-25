import express from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yamljs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import authRoutes from './routes/auth.routes.js';
import userRoutes from './routes/user.routes.js';
import validateRoutes from './routes/validate.routes.js';
import adminRoutes from './routes/admin.routes.js';
import lingkunganRoutes from './routes/lingkungan.routes.js';
import kependudukanRoutes from './routes/kependudukan.routes.js';
import submissionRoutes from './routes/submission.routes.js';
import letterRoutes from './routes/letter.routes.js';
import keyRoutes from './routes/key.routes.js';
import verificationRoutes from './routes/verification.routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const swaggerDocument = YAML.load(join(__dirname, '..', 'swagger.yaml'));

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static assets (logos, etc.)
app.use('/assets', express.static(join(__dirname, '..', 'public', 'assets')));

// Serve public letters (generated PDFs)
app.use('/public/letters', express.static(join(__dirname, '..', 'public', 'letters')));

// Swagger documentation
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/v1/auth', authRoutes);
app.use('/v1/users', userRoutes);
app.use('/v1/validate-requests', validateRoutes);
app.use('/v1/admin', adminRoutes);
app.use('/v1/lingkungan', lingkunganRoutes);
app.use('/v1/data-kependudukan', kependudukanRoutes);
app.use('/v1/submissions', submissionRoutes);
app.use('/v1/letters', letterRoutes);
app.use('/v1/keys', keyRoutes);
app.use('/v1/verify', verificationRoutes);
app.use('/verify', verificationRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.use((err, req, res) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
});

export default app;
