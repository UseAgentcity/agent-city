#!/usr/bin/env bash
# Build locally, upload to the agentcity.xyz server, precompress static files, restart services.
# Never uploads .env files, wallet data, node_modules or local game data.
set -euo pipefail
cd "$(dirname "$0")/.."
HOST=root@103.91.144.83
SSH=(ssh -i "$HOME/.ssh/agentcity_deploy" -o IdentitiesOnly=yes -o BatchMode=yes)
export PATH=/Users/peng/.local/node/bin:$PATH

(cd game && npm run build)

for d in game contracts; do
  rsync -az --delete -e "${SSH[*]}" \
    --exclude node_modules --exclude '.env' --exclude '.env.*' --exclude game-data \
    --exclude .backups --exclude .DS_Store --exclude cache \
    "$d/" "$HOST:/opt/agentcity/$d/"
done

"${SSH[@]}" "$HOST" 'set -e
cd /opt/agentcity
export PATH=/opt/node22/bin:$PATH
chown -R agentcity:agentcity /opt/agentcity
for d in game contracts; do (cd $d && sudo -u agentcity env PATH=$PATH HOME=/opt/agentcity npm install --omit=dev --ignore-scripts --no-audit --no-fund >/dev/null); done
# nginx serves these .gz siblings via gzip_static; rsync --delete removes them on every upload.
find game/client/dist -type f \( -name "*.js" -o -name "*.css" -o -name "*.html" -o -name "*.svg" -o -name "*.json" -o -name "*.glb" -o -name "*.wasm" \) -size +1k -exec gzip -9 -k -f {} \;
chown -R agentcity:agentcity /opt/agentcity
systemctl restart agentcity-arena agentcity-city
sleep 3
systemctl is-active agentcity-arena agentcity-city'
