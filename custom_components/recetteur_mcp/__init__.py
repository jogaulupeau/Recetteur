"""Recetteur MCP : rend le serveur MCP de l'app Recetteur joignable à distance, par un webhook Home Assistant.

L'ingress de Home Assistant exige une session de navigateur : un client comme Claude (cloud) ne peut pas l'utiliser. Un webhook,
lui, est joignable sur votre adresse Nabu Casa (https://….ui.nabu.casa/api/webhook/<secret>). Cette intégration y branche un
relais vers le serveur MCP de l'app, joint par le réseau interne : le port 8100 n'a pas besoin d'être publié.

Deux façons de la configurer : l'assistant (Paramètres → Appareils et services), ou — recommandé — l'app « Recetteur MCP », qui
l'installe et écrit `recetteur_mcp.json` dans le dossier de configuration : l'intégration l'importe alors toute seule.
"""
from __future__ import annotations

import logging

from aiohttp import web

from homeassistant.components import persistent_notification, webhook
from homeassistant.config_entries import SOURCE_IMPORT, ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.typing import ConfigType

from .const import CONF_URL, CONF_WEBHOOK_ID, DOMAIN, MANAGED_FILE, NOTIFICATION_ID
from .helpers import webhook_url
from .managed import read_managed
from .proxy import relay

_LOGGER = logging.getLogger(__name__)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Mode géré : importe (ou met à jour) l'entrée d'après le fichier écrit par l'app Recetteur MCP."""
    data = await hass.async_add_executor_job(read_managed, hass.config.path(MANAGED_FILE))
    if data is not None:
        hass.async_create_task(_sync_managed(hass, data))
    return True


async def _sync_managed(hass: HomeAssistant, data: dict[str, str]) -> None:
    entries = hass.config_entries.async_entries(DOMAIN)
    if not entries:
        await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_IMPORT}, data=data)
        _announce(hass, data[CONF_WEBHOOK_ID])
        return
    entry = entries[0]
    if dict(entry.data) != data:
        hass.config_entries.async_update_entry(entry, data=data)
        await hass.config_entries.async_reload(entry.entry_id)
        _announce(hass, data[CONF_WEBHOOK_ID])


def _announce(hass: HomeAssistant, webhook_id: str) -> None:
    """Notification avec l'URL à donner à Claude (elle contient un secret : visible des administrateurs seulement)."""
    persistent_notification.async_create(
        hass,
        "Recetteur MCP est prêt. Dans Claude, ajoutez un connecteur personnalisé vers :\n\n"
        f"`{webhook_url(hass, webhook_id)}`\n\n"
        "avec l'en-tête de requête `Authorization: Bearer <votre jeton mcp_token>`. "
        "Cette adresse contient un secret : ne la partagez pas.",
        title="Recetteur MCP",
        notification_id=NOTIFICATION_ID,
    )


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Enregistre le webhook de relais."""
    target = entry.data[CONF_URL]
    session = async_get_clientsession(hass)

    async def _handle(hass: HomeAssistant, webhook_id: str, request: web.Request) -> web.Response:
        return await relay(session, target, request)

    webhook_id = entry.data[CONF_WEBHOOK_ID]
    # On mémorise l'identifiant réellement enregistré : au déchargement, `entry.data` peut déjà contenir le NOUVEAU
    # identifiant (mise à jour puis rechargement) ; sans cela l'ancien webhook resterait actif après une rotation du secret.
    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = webhook_id
    webhook.async_register(
        hass,
        DOMAIN,
        "Recetteur MCP",
        webhook_id,
        _handle,
        local_only=False,  # c'est tout l'intérêt : joignable depuis Internet
        allowed_methods=["POST"],
    )
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Retire le webhook (celui qui a été enregistré, pas forcément celui des données actuelles)."""
    webhook_id = hass.data.get(DOMAIN, {}).pop(entry.entry_id, None)
    if webhook_id is not None:
        webhook.async_unregister(hass, webhook_id)
    return True
