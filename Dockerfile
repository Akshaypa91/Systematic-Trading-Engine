FROM node:20-alpine

# Security: run as non-root
RUN addgroup -S trader && adduser -S trader -G trader

WORKDIR /app

# Install deps first (layer cache)
COPY package*.json ./
RUN npm ci --only=production

# Copy source
COPY src/        ./src/
COPY scripts/    ./scripts/

# Log directory owned by app user
RUN mkdir -p logs && chown -R trader:trader /app

USER trader

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "src/app.js"]
