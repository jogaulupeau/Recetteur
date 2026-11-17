#!/usr/bin/with-contenv bashio
set -e

# /data : recettes, menus et état des courses, conservés d'une mise à jour à l'autre.
export RECETTEUR_DATA_DIR=/data
mkdir -p /data

# Le port n'est pas publié : seul l'ingress du Supervisor l'atteint.
export HOST=0.0.0.0
export PORT=8099

bashio::log.info "Recetteur demarre sur le port 8099 (ingress)."
exec node /opt/recetteur/server/index.js
