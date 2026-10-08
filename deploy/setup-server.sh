#!/usr/bin/env bash
# ==========================================================================
# KentraPix — installation / mise à jour sur un serveur Ubuntu 24.04 (Oracle Cloud, Hetzner…)
#
# Lancé automatiquement par deploy.ps1 depuis Windows. Peut être relancé sans risque :
# il n'écrase ni la base de données, ni les photos, ni le fichier .env existant.
#
#   sudo APP_DOMAIN=kentrapix.kenleyelysee.com TUNNEL_TOKEN=... bash setup-server.sh
#
# Organisation sur le serveur :
#   /opt/kentrapix/app       code (remplacé à chaque déploiement)
#   /opt/kentrapix/storage   photos privées (jamais touchées par un déploiement)
#   /opt/kentrapix/backups   sauvegardes MySQL quotidiennes (14 jours)
#   /opt/kentrapix/kentrapix.env   configuration + secrets (lien server/.env)
# ==========================================================================
set -euo pipefail

APP_DOMAIN="${APP_DOMAIN:-kentrapix.kenleyelysee.com}"
TUNNEL_TOKEN="${TUNNEL_TOKEN:-}"
SECRETS_FILE="${SECRETS_FILE:-/tmp/kentrapix-secrets.env}"   # clés Resend, envoyées par deploy.ps1
BASE=/opt/kentrapix
APP="$BASE/app"
ENV_FILE="$BASE/kentrapix.env"
NODE_MAJOR=24

say() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
[ "$(id -u)" -eq 0 ] || { echo "Lancez ce script avec sudo."; exit 1; }
[ -d "$APP/server" ] || { echo "Code introuvable dans $APP (lancez deploy.ps1 depuis Windows)."; exit 1; }

say "Paquets système"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg mysql-server >/dev/null

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt "$NODE_MAJOR" ]; then
  say "Node.js $NODE_MAJOR"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
echo "Node $(node -v) · $(mysql --version | awk '{print $1, $2, $3}')"

say "Compte système kentrapix"
id kentrapix >/dev/null 2>&1 || useradd --system --home "$BASE" --shell /usr/sbin/nologin kentrapix
mkdir -p "$BASE/storage" "$BASE/backups"

say "MySQL : base et utilisateur"
systemctl enable --now mysql >/dev/null
if [ ! -f "$ENV_FILE" ]; then
  DB_PASSWORD="$(openssl rand -base64 30 | tr -dc 'A-Za-z0-9' | head -c 32)"
  mysql <<SQL
CREATE DATABASE IF NOT EXISTS kentrapix CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'kentrapix'@'localhost' IDENTIFIED BY '${DB_PASSWORD}';
ALTER USER 'kentrapix'@'localhost' IDENTIFIED BY '${DB_PASSWORD}';
GRANT ALL PRIVILEGES ON kentrapix.* TO 'kentrapix'@'localhost';
FLUSH PRIVILEGES;
SQL

  say "Configuration de production ($ENV_FILE)"
  JWT_SECRET="$(openssl rand -base64 64 | tr -dc 'A-Za-z0-9' | head -c 64)"
  cat > "$ENV_FILE" <<ENV
# KentraPix — production (généré par setup-server.sh). Ne jamais partager ce fichier.
NODE_ENV=production
PORT=3000
HOST=127.0.0.1
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=kentrapix
DB_PASSWORD=${DB_PASSWORD}
DB_NAME=kentrapix
JWT_SECRET=${JWT_SECRET}
SESSION_DAYS=7
STORAGE_DIR=${BASE}/storage
MAX_UPLOAD_MB=50
PREVIEW_WIDTH=1600
TRUST_PROXY=true
APP_URL=https://${APP_DOMAIN}
ENV
fi
# Clés e-mail (Resend) envoyées depuis le PC : ajoutées ou mises à jour.
if [ -f "$SECRETS_FILE" ]; then
  while IFS='=' read -r key value; do
    [[ "$key" =~ ^(RESEND_API_KEY|MAIL_FROM|MAIL_REPLY_TO)$ ]] || continue
    sed -i "/^${key}=/d" "$ENV_FILE"
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  done < <(tr -d '\r' < "$SECRETS_FILE")
  shred -u "$SECRETS_FILE" 2>/dev/null || rm -f "$SECRETS_FILE"
fi
sed -i "s#^APP_URL=.*#APP_URL=https://${APP_DOMAIN}#" "$ENV_FILE"
ln -sf "$ENV_FILE" "$APP/server/.env"

say "Dépendances Node (peut prendre quelques minutes)"
cd "$APP/server"
npm ci --omit=dev --no-audit --no-fund --loglevel=error

say "Base de données : tables et migrations"
node scripts/db-init.js | tail -n 3

chown -R kentrapix:kentrapix "$BASE"
chmod 600 "$ENV_FILE"

say "Service kentrapix (démarrage automatique)"
cat > /etc/systemd/system/kentrapix.service <<UNIT
[Unit]
Description=KentraPix
After=network-online.target mysql.service
Wants=network-online.target
Requires=mysql.service

[Service]
User=kentrapix
WorkingDirectory=${APP}/server
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=3
Environment=NODE_ENV=production
# Durcissement
NoNewPrivileges=true
ProtectSystem=full
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable kentrapix >/dev/null
systemctl restart kentrapix

say "Sauvegarde quotidienne de la base (14 jours)"
cat > /etc/cron.daily/kentrapix-backup <<'CRON'
#!/bin/sh
# Sauvegarde MySQL de KentraPix : /opt/kentrapix/backups/kentrapix-AAAA-MM-JJ.sql.gz
set -e
mysqldump --single-transaction --routines kentrapix | gzip > /opt/kentrapix/backups/kentrapix-$(date +%F).sql.gz
find /opt/kentrapix/backups -name 'kentrapix-*.sql.gz' -mtime +14 -delete
CRON
chmod 755 /etc/cron.daily/kentrapix-backup

if [ -n "$TUNNEL_TOKEN" ]; then
  say "Cloudflare Tunnel"
  if ! command -v cloudflared >/dev/null; then
    ARCH="$(dpkg --print-architecture)"
    curl -fsSL -o /tmp/cloudflared.deb "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH}.deb"
    dpkg -i /tmp/cloudflared.deb >/dev/null && rm -f /tmp/cloudflared.deb
  fi
  if systemctl list-unit-files | grep -q '^cloudflared.service'; then
    echo "Tunnel déjà installé."
  else
    cloudflared service install "$TUNNEL_TOKEN"
  fi
  systemctl enable --now cloudflared >/dev/null
fi

say "Vérification"
for i in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    echo "KentraPix fonctionne. Adresse publique : https://${APP_DOMAIN}"
    exit 0
  fi
  sleep 1
done
echo "KentraPix ne répond pas encore. Journal : sudo journalctl -u kentrapix -n 50"
exit 1
