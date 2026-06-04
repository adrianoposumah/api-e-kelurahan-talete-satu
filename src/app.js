import express from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yamljs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as Sentry from '@sentry/node';

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
import notificationRoutes from './routes/notification.routes.js';
import arsipRoutes from './routes/arsip.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import env from './config/env.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const swaggerDocument = YAML.load(join(__dirname, '..', 'swagger.yaml'));

const app = express();
const allowedOrigins = [
  ...(env.ADMIN_DASHBOARD_URL
    ? env.ADMIN_DASHBOARD_URL.split(',')
        .map((origin) => origin.trim())
        .filter(Boolean)
    : []),
  ...(env.VERIFICATION_URL
    ? env.VERIFICATION_URL.split(',')
        .map((origin) => origin.trim())
        .filter(Boolean)
    : []),
].filter((v, i, a) => v && a.indexOf(v) === i);

// Middleware
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(null, false);
    },
    credentials: true,
  }),
);
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
  res.json({
    status: 'ok',
    timestamp: new Date(),
    timezone: process.env.TZ || 'Asia/Makassar',
    env: process.env.NODE_ENV,
  });
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
app.use('/v1/notifications', notificationRoutes);
app.use('/v1/arsip', arsipRoutes);
app.use('/v1/dashboard', dashboardRoutes);

if (process.env.NODE_ENV !== 'production') {
  app.get('/debug-sentry', function mainHandler(_req, _res) {
    throw new Error('My first Sentry error!');
  });
}

Sentry.setupExpressErrorHandler(app);

Sentry.metrics.count('button_click', 1);
Sentry.metrics.gauge('page_load_time', 150);
Sentry.metrics.distribution('response_time', 200);

Sentry.logger.info('User triggered test log', { action: 'test_log' });

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.use((err, _req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  console.error(err.stack || err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
});

export default app;
