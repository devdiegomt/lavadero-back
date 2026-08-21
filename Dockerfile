FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc --project tsconfig.json

FROM node:20-alpine
RUN addgroup -g 1001 -S appgroup && adduser -S appuser -u 1001 -G appgroup
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist/ ./dist/
# Copiar migraciones .js (necesarias para npm run db:migrate en producción)
COPY src/shared/db/*.js ./src/shared/db/
RUN chown -R appuser:appgroup /app
USER appuser
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1
EXPOSE 3000
ENV NODE_ENV=production
CMD ["node", "dist/src/index.js"]