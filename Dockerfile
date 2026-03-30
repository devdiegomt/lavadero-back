# ============================================================================
# Carwash SaaS — Dockerfile para producción
# ============================================================================
# Build: docker build -t carwash-api ./backend
# Run:   docker run -p 3000:3000 --env-file .env carwash-api
# ============================================================================

FROM node:20-alpine AS base

RUN addgroup -g 1001 -S appgroup && adduser -S appuser -u 1001 -G appgroup

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src/ ./src/

RUN chown -R appuser:appgroup /app
USER appuser

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

EXPOSE 3000
ENV NODE_ENV=production
CMD ["node", "src/index.js"]
