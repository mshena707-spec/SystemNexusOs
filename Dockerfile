# ── Build Stage ───────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Install build dependencies for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++ gcc libc-dev

COPY package*.json ./
# Install dependencies: use npm ci when package-lock.json exists, otherwise fall back to npm install
RUN if [ -f package-lock.json ]; then npm ci; else npm install --no-audit --prefer-offline; fi

COPY . .
# Build the frontend. No "|| true" — a real build failure should stop the
# image here with a clear error, not surface later as a confusing crash.
RUN npm run build

# ── Production Stage ──────────────────────────────────────────────────
FROM node:22-alpine AS production

WORKDIR /app

# Runtime-only utilities
RUN apk add --no-cache tini curl

# Create non-root user
RUN addgroup -g 1001 nexus && adduser -u 1001 -G nexus -s /bin/sh -D nexus

# Copy package metadata and install production deps only
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev && npm cache clean --force; else npm install --omit=dev --no-audit --prefer-offline && npm cache clean --force; fi

# Copy runtime artifacts from the builder stage.
# The app runs as `tsx server.ts` (see package.json's "start" script) —
# there is no compiled dist/server.js, so the actual server source and
# everything it imports must be present, not just the built frontend.
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/server.ts ./server.ts
COPY --from=builder /app/src ./src
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/tsconfig.server.json ./tsconfig.server.json
# Firebase project identifiers (public names, not secrets). The server must talk to the very
# same Firestore database the web app uses, and reads its name from this file.
COPY --from=builder /app/firebase-applet-config.json ./firebase-applet-config.json

# Data directory (SQLite, logs, uploads)
RUN mkdir -p /data /app/logs /app/uploads && chown -R nexus:nexus /data /app/logs /app/uploads

USER nexus

# Always run in production mode inside this image (the web app is served from /app/dist).
ENV NODE_ENV=production

EXPOSE 3000

# Health check — Railway assigns PORT dynamically; fall back to 3000 for
# local/manual runs where PORT isn't set.
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:${PORT:-3000}/api/health || exit 1

# Use tini for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]
# Same steps as `npm start` (check the settings, then start the server), but the server is
# started with `exec` so IT — not a shell or npm in between — receives Railway's stop signal.
# That lets it finish in-flight orders and close the database cleanly during a redeploy.
CMD ["sh", "-c", "node scripts/validate-env.js && exec node --import tsx server.ts"]
