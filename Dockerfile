# ─────────────────────────────────────────────────────────────────────────────
# Systematic Trading Engine — Production Dockerfile
# Multi-stage: build deps separately so the final image stays lean
# ─────────────────────────────────────────────────────────────────────────────

# Stage 1: Install production deps
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Stage 2: Final image
FROM node:20-alpine AS runner
WORKDIR /app

# Security: run as non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 trading

# Copy deps from stage 1
COPY --from=deps --chown=trading:nodejs /app/node_modules ./node_modules

# Copy application source (exclude dev files via .dockerignore)
COPY --chown=trading:nodejs . .

# Create directories the app needs at runtime
RUN mkdir -p logs && chown trading:nodejs logs

# Drop privileges
USER trading

# Expose port
EXPOSE 3000

# Health check (Docker will mark container unhealthy if this fails)
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

# Start command
CMD ["node", "src/app.js"]
