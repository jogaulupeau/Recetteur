"""Constantes de l'intégration Recetteur MCP."""

DOMAIN = "recetteur_mcp"
CONF_URL = "url"
CONF_WEBHOOK_ID = "webhook_id"
DEFAULT_URL = "http://local-recetteur:8100/mcp"

# Mode « géré » : l'app Recetteur MCP écrit ce fichier dans le dossier de configuration de Home Assistant,
# l'intégration l'importe au démarrage (aucune saisie, ni HACS).
MANAGED_FILE = "recetteur_mcp.json"
NOTIFICATION_ID = "recetteur_mcp_url"
