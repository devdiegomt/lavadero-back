require("dotenv").config();
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
/* const whatsappRoutes = require("./modules/whatsapp/whatsapp.routes"); */
const billingRoutes = require("./modules/billing/billing.routes");
const logger = require('./shared/utils/logger');
const { httpLogger } = require('./shared/utils/logger');
const { errorHandler } = require("./shared/middleware/errorHandler");

const app = express();
const PORT = process.env.PORT || 3000;

/* const Redis = require("ioredis"); */
/* const { initWhatsApp } = require("./modules/whatsapp/whatsapp.controller");
const {
  sendAppointmentReminders,
} = require("./modules/whatsapp/notifications"); */

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

// Rate limiting global
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

// ---------------------------------------------------------------------------
// Health Check
// ---------------------------------------------------------------------------
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV,
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
/* app.use("/api/whatsapp", whatsappRoutes); */
app.use("/api/billing", billingRoutes);
app.use('/api/onboarding', onboardingRoutes);
app.use('/api/superadmin', superadminRoutes);

// ---------------------------------------------------------------------------
// Error Handler (siempre al final)
// ---------------------------------------------------------------------------
app.use(errorHandler);

// Redis para sesiones de WhatsApp
/* const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");
redis.on("connect", () => logger.info("🔴 Redis conectado"));
redis.on("error", (err) => console.error("❌ Redis error:", err.message));
initWhatsApp(redis); */

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  logger.info(`🚿 Carwash API corriendo en puerto ${PORT}`);
  logger.info(`   Ambiente: ${process.env.NODE_ENV || "development"}`);
  logger.info(`   Health:   http://localhost:${PORT}/api/health`);
});

const { initCronJobs } = require('./shared/db/cron');
initCronJobs();

// Cron: recordatorios de citas cada 5 minutos
/* setInterval(
  async () => {
    try {
      await sendAppointmentReminders();
    } catch (err) {
      console.error("[Cron] Error en recordatorios:", err.message);
    }
  },
  5 * 60 * 1000,
); */

module.exports = app;
