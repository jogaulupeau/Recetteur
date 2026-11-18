#!/usr/bin/with-contenv bashio
set -e

# /data : recettes, menus et état des courses, conservés d'une mise à jour à l'autre.
export RECETTEUR_DATA_DIR=/data
mkdir -p /data

# Le port n'est pas publié, et l'app refuse en plus toute connexion qui ne vient pas de l'ingress du Supervisor
# (172.30.32.2) : un autre add-on ou un appareil du réseau ne peut pas la joindre directement.
# Si l'interface ne s'ouvre plus après une mise à jour de Home Assistant, décocher l'option « ingress_only ».
export HOST=0.0.0.0
export PORT=8099
if bashio::config.true 'ingress_only'; then
    export RECETTEUR_ALLOWED_PEERS=172.30.32.2
fi

export RECETTEUR_VERSION="$(bashio::addon.version)"
export RECETTEUR_MCP_PORT=8100

bashio::log.info "Recetteur demarre sur le port 8099 (ingress)."
exec node /opt/recetteur/server/index.js
