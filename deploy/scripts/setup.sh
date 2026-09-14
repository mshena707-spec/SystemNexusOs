#!/bin/bash
# NEXUS OS — Server Setup Script
# Run once on a fresh Ubuntu 22.04 VPS
# Usage: curl -sSL https://your-domain.com/setup.sh | sudo bash

set -euo pipefail
COLOR_GREEN='\033[0;32m'; COLOR_YELLOW='\033[1;33m'; NC='\033[0m'
log() { echo -e "${COLOR_GREEN}[NEXUS SETUP]${NC} $1"; }
warn() { echo -e "${COLOR_YELLOW}[WARNING]${NC} $1"; }

log "Starting Nexus OS server setup..."

# 1. System update
log "Updating system packages..."
apt-get update -qq && apt-get upgrade -y -qq

# 2. Docker
if ! command -v docker &>/dev/null; then
  log "Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  usermod -aG docker $USER
fi

# 3. Docker Compose
if ! docker compose version &>/dev/null; then
  log "Installing Docker Compose plugin..."
  apt-get install -y docker-compose-plugin
fi

# 4. Create app directory
APP_DIR="/opt/nexus-os"
log "Creating app directory: $APP_DIR"
mkdir -p $APP_DIR/{logs/nginx,deploy/nginx/ssl}
cd $APP_DIR

# 5. SSL certificate (Let's Encrypt)
if [ -n "${DOMAIN:-}" ]; then
  log "Setting up SSL for $DOMAIN..."
  apt-get install -y certbot
  certbot certonly --standalone -d $DOMAIN \
    --non-interactive --agree-tos \
    --email ${ADMIN_EMAIL:-admin@$DOMAIN}
  cp /etc/letsencrypt/live/$DOMAIN/fullchain.pem $APP_DIR/deploy/nginx/ssl/
  cp /etc/letsencrypt/live/$DOMAIN/privkey.pem $APP_DIR/deploy/nginx/ssl/
  # Auto-renew
  (crontab -l 2>/dev/null; echo "0 0 1 * * certbot renew --quiet && cp /etc/letsencrypt/live/$DOMAIN/fullchain.pem $APP_DIR/deploy/nginx/ssl/ && cp /etc/letsencrypt/live/$DOMAIN/privkey.pem $APP_DIR/deploy/nginx/ssl/ && docker compose -f $APP_DIR/docker-compose.yml restart nginx") | crontab -
  log "SSL configured and auto-renewal set"
else
  warn "DOMAIN not set — skipping SSL. Set DOMAIN=your-domain.com to enable HTTPS."
fi

# 6. Firewall
log "Configuring firewall..."
ufw --force enable
ufw allow ssh
ufw allow 80/tcp
ufw allow 443/tcp
ufw deny 6379/tcp  # Block Redis from external
ufw deny 6333/tcp  # Block Qdrant from external
ufw deny 9090/tcp  # Block Prometheus from external
ufw deny 3001/tcp  # Block Grafana from external

log "✅ Server setup complete!"
log "Next steps:"
log "  1. cd $APP_DIR"
log "  2. cp .env.example .env && nano .env"
log "  3. docker compose up -d --build"
