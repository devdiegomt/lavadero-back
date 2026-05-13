import 'dotenv/config';
import express, { type Express, type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import authRoutes        from './modules/auth/auth.routes';
import tenantRoutes      from './modules/tenants/tenant.routes';
import customerRoutes    from './modules/customers/customers.routes';
import vehicleRoutes     from './modules/vehicles/vehicles.routes';
import serviceRoutes     from './modules/services/services.routes';
import appointmentRoutes from './modules/appointments/appointments.routes';
import paymentRoutes     from './modules/payments/payments.routes';
import userRoutes        from './modules/users/users.routes';
import historyRoutes     from './modules/history/history.routes';
import reportRoutes      from './modules/reports/reports.routes';
import onboardingRoutes  from './modules/onboarding/onboarding.routes';
import superadminRoutes  from './modules/superadmin/superadmin.routes';
import billingRoutes     from './modules/billing/billing.routes';
import waBridgeRoutes    from './modules/whatsapp/wa-bridge.routes';

import logger, { httpLogger } from './shared/utils/logger';
import { errorHandler } from './shared/middleware/errorHandler';
import { initCronJobs } from './shared/db/cron';

const app: Express = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// ---------------------------------------------------------------------------
// Middleware Global
// ---------------------------------------------------------------------------
app.use(helmet());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
    credentials: true,
  }),
);
app.use(express.json({ limit: '1mb' }));
app.use(httpLogger());

// Rate limiting global
const limiter = rateLimit({
  windowMs: process.env.RATE_LIMIT_WINDOW_MS
    ? parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10)
    : 15 * 60 * 1_000,
  max: process.env.RATE_LIMIT_MAX ? parseInt(process.env.RATE_LIMIT_MAX, 10) : 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Demasiadas solicitudes. Intenta de nuevo en unos minutos.',
  },
});
app.use('/api/', limiter);

// ---------------------------------------------------------------------------
// Health Check
// ---------------------------------------------------------------------------
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV,
  });
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.use('/api/auth',         authRoutes);
app.use('/api/tenants',      tenantRoutes);
app.use('/api/customers',    customerRoutes);
app.use('/api/vehicles',     vehicleRoutes);
app.use('/api/services',     serviceRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/payments',     paymentRoutes);
app.use('/api/users',        userRoutes);
app.use('/api/history',      historyRoutes);
app.use('/api/reports',      reportRoutes);
app.use('/api/billing',      billingRoutes);
app.use('/api/onboarding',   onboardingRoutes);
app.use('/api/superadmin',   superadminRoutes);

// WhatsApp AI Bridge (consumido por n8n)
app.use('/api/wa-bridge', waBridgeRoutes);

// ---------------------------------------------------------------------------
// Error Handler (siempre al final)
// ---------------------------------------------------------------------------
app.use(errorHandler);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
// En tests (NODE_ENV=test) NO levantamos el servidor — supertest usa `app`
// directamente y abrir un puerto crearía conflictos al correr en paralelo.
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    logger.info(`🚿 Carwash API corriendo en puerto ${PORT}`);
    logger.info(`   Ambiente: ${process.env.NODE_ENV ?? 'development'}`);
    logger.info(`   Health:   http://localhost:${PORT}/api/health`);
    logger.info(`   WA Bridge: http://localhost:${PORT}/api/wa-bridge`);
  });

  initCronJobs();
}

export default app;