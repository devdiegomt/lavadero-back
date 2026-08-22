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
# Las migraciones y seeds ya vienen compiladas en dist/src/shared/db/.
# Antes se copiaban los .js de src/, pero desde que pasaron a TypeScript ese
# glob no matchea nada y un COPY sin coincidencias rompe el build.
# En produccion se ejecutan con los scripts db:*:prod (node sobre dist/),
# porque aca no hay ts-node: la imagen instala solo dependencias de runtime.
RUN chown -R appuser:appgroup /app
USER appuser
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1
EXPOSE 3000
ENV NODE_ENV=production
CMD ["node", "dist/src/index.js"]