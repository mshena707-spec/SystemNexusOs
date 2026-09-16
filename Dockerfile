# ── Build Stage ───────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Install build dependencies for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++ gcc libc-dev

COPY package*.json ./
# Use npm ci when a lockfile is present for reproducible installs
RUN npm ci

COPY . .
# Build the project (ignore non-zero exit to allow projects without a build step)
RUN npm run build || true

# ── Production Stage ──────────────────────────────────────────────────
FROM node:22-alpine AS production

WORKDIR /app

# Runtime-only utilities
RUN apk add --no-cache tini curl

# Create non-root user
RUN addgroup -g 1001 nexus && adduser -u 1001 -G nexus -s /bin/sh -D nexus

# Copy package metadata and install production deps only
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy runtime artifacts from the builder stage
COPY --from=builder /app/dist ./dist
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
# Run the compiled JavaScript entrypoint. Adjust path if your build outputs a different filename.
CMD ["node", "dist/server.js"]
