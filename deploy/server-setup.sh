#!/usr/bin/env bash
# One-time setup of the agentcity.world server (Ubuntu 24.04, Node 22 and nginx already installed):
# a service user, the two systemd services and the nginx site. Safe to run again; it leaves other sites alone.
# The city runs in demo mode until /opt/agentcity/arena.env points at the live contract (TYCOON_CONTRACT, TYCOON_RPC,
# TYCOON_FROM_BLOCK); this script writes that file only if it is missing.
set -euo pipefail
cd "$(dirname "$0")"
HOST=${AGENTCITY_HOST:-root@36.50.84.201}
DOMAIN=${AGENTCITY_DOMAIN:-agentcity.world}
SSH=(ssh -i "${AGENTCITY_KEY:-$HOME/.ssh/agentcity_world}" -o IdentitiesOnly=yes -o BatchMode=yes)

"${SSH[@]}" "$HOST" DOMAIN="$DOMAIN" bash -s <<'REMOTE'
set -euo pipefail
id agentcity >/dev/null 2>&1 || useradd --system --home /opt/agentcity --shell /usr/sbin/nologin agentcity
mkdir -p /opt/agentcity/game /opt/agentcity/contracts /opt/agentcity/.openworld
SCHEME=http; [ -d "/etc/letsencrypt/live/$DOMAIN" ] && SCHEME=https

[ -f /opt/agentcity/arena.env ] || cat > /opt/agentcity/arena.env <<EOF
ARENA_PORT=5320
ARENA_PUBLIC_ORIGIN=$SCHEME://$DOMAIN
# One game day: 1.5 hours, the live pace (a season is 12 hours).
TYCOON_DAY_MS=5400000
TYCOON_TOKEN_SYMBOL=ACITY
# Live city contract (empty = demo shopkeepers only). The API only reads the chain.
TYCOON_CONTRACT=
TYCOON_RPC=https://bsc-dataseed.bnbchain.org
TYCOON_FROM_BLOCK=0
EOF
cat > /opt/agentcity/city.env <<EOF
CITY_PORT=5417
CITY_ORIGIN=$SCHEME://$DOMAIN
ARENA_PORT=5320
EOF
chmod 640 /opt/agentcity/arena.env /opt/agentcity/city.env
chown -R agentcity:agentcity /opt/agentcity

cat > /etc/systemd/system/agentcity-arena.service <<'EOF'
[Unit]
Description=Agent City arena API
After=network-online.target
[Service]
User=agentcity
WorkingDirectory=/opt/agentcity/contracts
EnvironmentFile=/opt/agentcity/arena.env
ExecStart=/usr/bin/node service/game-server.mjs
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/opt/agentcity/contracts
[Install]
WantedBy=multi-user.target
EOF
cat > /etc/systemd/system/agentcity-city.service <<'EOF'
[Unit]
Description=Agent City web app
After=network-online.target agentcity-arena.service
[Service]
User=agentcity
WorkingDirectory=/opt/agentcity/game
EnvironmentFile=/opt/agentcity/city.env
Environment=NODE_ENV=production
ExecStart=/opt/agentcity/game/node_modules/.bin/tsx server/city-server.ts
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/opt/agentcity/game /opt/agentcity/.openworld
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable agentcity-arena agentcity-city >/dev/null

# The HTTP site; certbot --nginx adds HTTPS to it once the domain points here.
if [ ! -f /etc/nginx/sites-available/$DOMAIN ]; then
cat > /etc/nginx/sites-available/$DOMAIN <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN www.$DOMAIN;
    server_tokens off;
    client_max_body_size 64k;
    if (\$host = www.$DOMAIN) { return 301 \$scheme://$DOMAIN\$request_uri; }
    root /opt/agentcity/game/client/dist;
    gzip on;
    gzip_static on;
    gzip_types text/css application/javascript application/json image/svg+xml model/gltf-binary application/wasm;
    location /assets/ {
        try_files \$uri =404;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
    location / {
        proxy_pass http://127.0.0.1:5417;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 30s;
    }
}
EOF
fi
ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/$DOMAIN
nginx -t
systemctl reload nginx
echo "setup done ($SCHEME://$DOMAIN)"
REMOTE
