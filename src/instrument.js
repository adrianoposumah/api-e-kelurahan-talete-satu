import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  integrations: [
    // send console.log, console.warn, and console.error calls as logs to Sentry
    Sentry.consoleLoggingIntegration({ levels: ['log', 'warn', 'error'] }),
  ],
  enableLogs: true,
  // Setting this option to true will send default PII data to Sentry.
  // For example, automatic IP address collection on events
  sendDefaultPii: true,
  // Enables performance monitoring / request tracing (transactions per HTTP request).
  // Without this, only errors are captured — successful requests are not recorded.
  // 1.0 = trace 100% of requests. Lower it (e.g. 0.2) in production to control volume/cost.
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
});
