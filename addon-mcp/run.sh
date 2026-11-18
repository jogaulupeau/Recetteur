#!/usr/bin/with-contenv bashio
set -e

bashio::log.info "Recetteur MCP : preparation de l'integration de relais..."
exec python3 -u /opt/start.py
