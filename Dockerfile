# ── Build Stage ───────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Install build dependencies for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++ gcc libc-dev

COPY package*.json ./
RUN npm install --include=dev

COPY . .
RUN npm run build 2>/dev/null || true

# ── Production Stage ──────────────────────────────────────────────────
FROM node:22-alpine AS production

WORKDIR /app

# Runtime deps for native modules
RUN apk add --no-cache python3 make g++ gcc libc-dev tini curl

# Create non-root user
RUN addgroup -g 1001 nexus && adduser -u 1001 -G nexus -s /bin/sh -D nexus

# Copy package.json and install production deps
COPY package*.json ./RUN npm install --omit=dev && npm cache clean --force

# Copy built app
COPY --from=builder /app/dist ./dist 2>/dev/null || true
COPY --from=builder /app/src ./src
COPY --from=builder /app/server.ts ./
COPY --from=builder /app/tsconfig.json ./
COPY --from=builder /app/scripts ./scripts

# Data directory (SQLite, logs, uploads)
RUN mkdir -p /data /app/logs /app/uploads && chown -R nexus:nexus /data /app/logs /app/uploads

USER nexus

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

# Use tini for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--require", "ts-node/register", "server.ts"]
