#!/bin/bash
# deploy.sh — Production deployment helper
# Usage: ./scripts/deploy.sh [--migrate] [--seed]
set -euo pipefail

echo "════════════════════════════════════════"
echo "  Systematic Trading Engine — Deploy"
echo "════════════════════════════════════════"

# Require .env
if [ ! -f .env ]; then
  echo "❌ .env file not found. Copy .env.example and fill in values."
  exit 1
fi

# Load env
set -a; source .env; set +a

# Validate critical vars
for var in DB_PASSWORD JWT_SECRET DB_USER DB_NAME; do
  if [ -z "${!var:-}" ]; then
    echo "❌ Required env var $var is not set"
    exit 1
  fi
done

echo "✅ Environment validated"

# Run DB migrations if requested
if [[ "${1:-}" == "--migrate" ]] || [[ "${2:-}" == "--migrate" ]]; then
  echo "📦 Running database migrations..."
  node scripts/migrate.js
  echo "✅ Migrations complete"
fi

# Run seed if requested
if [[ "${1:-}" == "--seed" ]] || [[ "${2:-}" == "--seed" ]]; then
  echo "🌱 Running database seed..."
  node scripts/setup-complete.js
  echo "✅ Seed complete"
fi

# Build and start Docker services
echo "🐳 Building Docker image..."
docker compose build --no-cache

echo "🚀 Starting services..."
docker compose up -d

echo ""
echo "✅ Deployment complete"
echo "   Health: http://localhost:${PORT:-3000}/health"
echo "   Logs:   docker compose logs -f app"
echo ""
