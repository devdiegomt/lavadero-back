require("dotenv").config();
const sentry = require('./shared/utils/sentry');
sentry.init(); // Debe ejecutarse ANTES de cargar el resto para capturar errores en el bootstrap

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const authRoutes = require("./modules/auth/auth.routes");
const tenantRoutes = require("./modules/tenants/tenant.routes");
const customerRoutes = require("./modules/customers/customers.routes");
const vehicleRoutes = require("./modules/vehicles/vehicles.routes");
const serviceRoutes = require("./modules/services/services.routes");
const appointmentRoutes = require("./modules/appointments/appointments.routes");
const paymentRoutes = require("./modules/payments/payments.routes");
const userRoutes = require("./modules/users/users.routes");
const historyRoutes = require("./modules/history/history.routes");
const reportRoutes = require("./modules/reports/reports.routes");
const onboardingRoutes = require('./modules/onboarding/onboarding.routes');
const superadminRoutes = require('./modules/superadmin/superadmin.routes');
const billingRoutes = require("./modules/billing/billing.routes");
const waBridgeRoutes = require("./modules/whatsapp/wa-bridge.routes");
const logger = require('./shared/utils/logger');
const { httpLogger } = require('./shared/utils/logger');
const { errorHandler } = require("./shared/middleware/errorHandler");

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Trust proxy (Railway/Heroku/Nginx ponen X-Forwarded-For; sin esto rate-limit
// confunde 1 IP detrás del proxy con todos los usuarios).
// ---------------------------------------------------------------------------
app.set('trust proxy', 1);

// ---------------------------------------------------------------------------
// Middleware Global
// ---------------------------------------------------------------------------
app.use(helmet());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "http://localhost:5173",
    credentials: true,
  }),
);
app.use(express.json({ limit: "1mb" }));
app.use(httpLogger());

// Rate limiting global — todas las rutas /api
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Demasiadas solicitudes. Intenta de nuevo en unos minutos.",
  },
});
app.use("/api/", limiter);

// Rate limiting estricto — endpoints públicos sensibles.
// Previene abuso en signup/login (creación masiva de tenants, brute force).
// 5 intentos por IP cada 15 min.
const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.STRICT_RATE_LIMIT_MAX) || 5,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // login exitoso no consume cuota
  message: {
    error: "Demasiados intentos. Espera 15 minutos antes de intentar de nuevo.",
  },
});
app.use("/api/auth/login", strictLimiter);
app.use("/api/onboarding/register", strictLimiter);

// ---------------------------------------------------------------------------
// Health Check
// ---------------------------------------------------------------------------
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV,
    version: process.env.SENTRY_RELEASE || 'dev',
  });
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.use("/api/auth", authRoutes);
app.use("/api/tenants", tenantRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/vehicles", vehicleRoutes);
app.use("/api/services", serviceRoutes);
app.use("/api/appointments", appointmentRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/users", userRoutes);
app.use("/api/history", historyRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/billing", billingRoutes);
app.use('/api/onboarding', onboardingRoutes);
app.use('/api/superadmin', superadminRoutes);

// WhatsApp AI Bridge (consumido por n8n)
app.use("/api/wa-bridge", waBridgeRoutes);

// ---------------------------------------------------------------------------
// Sentry error handler (antes del errorHandler propio para capturar 5xx)
// ---------------------------------------------------------------------------
app.use(sentry.errorHandler());

// ---------------------------------------------------------------------------
// Error Handler (siempre al final)
// ---------------------------------------------------------------------------
app.use(errorHandler);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  logger.info(`\ud83d\udebf Carwash API corriendo en puerto ${PORT}`);
  logger.info(`   Ambiente: ${process.env.NODE_ENV || "development"}`);
  logger.info(`   Health:   http://localhost:${PORT}/api/health`);
  logger.info(`   WA Bridge: http://localhost:${PORT}/api/wa-bridge`);
});

const { initCronJobs } = require('./shared/db/cron');
initCronJobs();

module.exports = app;