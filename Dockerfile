# ─────────────────────────────────────────
# Stage 1: Install backend deps
# ─────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

# Copy backend package files
COPY backend/package.json backend/package-lock.json* ./

RUN npm install

# ─────────────────────────────────────────
# Stage 2: Final image
# ─────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

# Create user
RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 trading

# Copy node_modules
COPY --from=deps --chown=trading:nodejs /app/node_modules ./node_modules

# Copy backend code only
COPY --chown=trading:nodejs backend ./ 

# Create logs dir
RUN mkdir -p logs && chown trading:nodejs logs

USER trading

EXPOSE 3000

CMD ["node", "src/app.js"]