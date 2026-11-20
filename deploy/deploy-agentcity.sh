#!/usr/bin/env bash
# Build locally, upload to the agentcity.world server, precompress static files, restart services.
# Never uploads .env files, wallet data, node_modules or local game data. Run deploy/server-setup.sh once first.
set -euo pipefail
cd "$(dirname "$0")/.."
HOST=${AGENTCITY_HOST:-root@36.50.84.201}
SSH=(ssh -i "${AGENTCITY_KEY:-$HOME/.ssh/agentcity_world}" -o IdentitiesOnly=yes -o BatchMode=yes)

(cd game && npm run build)

for d in game contracts; do
  rsync -az --delete -e "${SSH[*]}" \
    --exclude node_modules --exclude '.env' --exclude '.env.*' --exclude game-data \
    --exclude .backups --exclude .DS_Store --exclude cache --exclude deployments \
    "$d/" "$HOST:/opt/agentcity/$d/"
done

"${SSH[@]}" "$HOST" 'set -e
cd /opt/agentcity
chown -R agentcity:agentcity /opt/agentcity
for d in game contracts; do (cd $d && sudo -u agentcity env HOME=/opt/agentcity npm install --omit=dev --ignore-scripts --no-audit --no-fund >/dev/null); done
# nginx serves these .gz siblings via gzip_static; rsync --delete removes them on every upload.
find game/client/dist -type f \( -name "*.js" -o -name "*.css" -o -name "*.html" -o -name "*.svg" -o -name "*.json" -o -name "*.glb" -o -name "*.wasm" \) -size +1k -exec gzip -9 -k -f {} \;
chown -R agentcity:agentcity /opt/agentcity
systemctl restart agentcity-arena agentcity-city
sleep 3
systemctl is-active agentcity-arena agentcity-city'
