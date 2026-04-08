# Production Deployment Guide
## Systematic Trading Engine

---

## Prerequisites

- Node.js ≥ 20
- Docker + Docker Compose ≥ 2.0
- MySQL 8 (or use the bundled Docker service)
- 1GB RAM minimum (2GB recommended)

---

## Step 1: Environment Setup

```bash
# Clone the repo
git clone <your-repo>
cd systematic-trading-engine

# Create .env from template
cp .env.example .env

# Generate a strong JWT_SECRET
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
# Paste the output as JWT_SECRET in .env

# Set a strong DB_PASSWORD in .env
# Set MYSQL_ROOT_PASSWORD in .env
```

---

## Step 2: Local Development

```bash
npm install
npm run db:migrate          # create tables
npm run db:seed             # seed sample price data
npm run dev                 # start with hot-reload (nodemon)

# Verify
curl http://localhost:3000/health
```

---

## Step 3: Docker Deployment

```bash
# Build and start all services (app + MySQL)
docker compose up -d

# Check health
docker compose ps
curl http://localhost:3000/health

# View logs
docker compose logs -f app

# Stop
docker compose down
```

---

## Step 4: VPS / AWS Deployment

### On Ubuntu 22.04 VPS:

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Clone and configure
git clone <repo> /opt/trading-engine
cd /opt/trading-engine
cp .env.example .env
# Edit .env with production values

# One-command deploy
npm run deploy
```

### Systemd service (alternative to Docker):

```ini
# /etc/systemd/system/trading-engine.service
[Unit]
Description=Systematic Trading Engine
After=network.target mysql.service

[Service]
Type=simple
User=trading
WorkingDirectory=/opt/trading-engine
ExecStart=/usr/bin/node src/app.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production
EnvironmentFile=/opt/trading-engine/.env
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable trading-engine
sudo systemctl start trading-engine
sudo journalctl -u trading-engine -f
```

---

## Step 5: Nginx Reverse Proxy (Recommended)

```nginx
# /etc/nginx/sites-available/trading-engine
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate     /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    # WebSocket support
    location /ws {
        proxy_pass         http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host $host;
        proxy_read_timeout 3600s;
    }

    location / {
        proxy_pass         http://localhost:3000;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}
```

---

## Step 6: Health Monitoring

```bash
# Manual health check
npm run health
# or
curl http://localhost:3000/health | jq

# Docker health status
docker inspect trading-engine | jq '.[0].State.Health'

# Set up cron for monitoring
# crontab -e
*/5 * * * * /usr/bin/node /opt/trading-engine/scripts/health-check.js >> /var/log/trading-health.log 2>&1
```

---

## API Endpoints

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | /health | System health + scheduler status | None |
| POST | /api/auth/signup | Register user | None |
| POST | /api/auth/login | Login, returns JWT | None |
| GET | /api/auth/me | Verify token | JWT |
| GET | /api/signal/:symbol | Generate signal | Optional |
| POST | /api/backtest | Run backtest | Optional |
| GET | /api/trade/portfolio | Paper portfolio state | Optional |
| GET | /api/screener | Screen NIFTY50 | Optional |

---

## Environment Variables Reference

See `.env.example` for complete documentation.

Critical variables (must set in production):
- `JWT_SECRET` — 64-char random hex
- `DB_PASSWORD` — strong database password
- `MYSQL_ROOT_PASSWORD` — MySQL root password (Docker only)
- `NODE_ENV=production`
