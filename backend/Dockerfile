# backend/Dockerfile
FROM node:22-alpine

# Security: run as non-root
RUN addgroup -S systra && adduser -S systra -G systra

WORKDIR /app

# Install deps first (layer cache)
COPY package*.json ./
RUN npm ci --production --ignore-scripts

# Copy source
COPY src ./src

# Ownership
RUN chown -R systra:systra /app
USER systra

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "src/app.js"]