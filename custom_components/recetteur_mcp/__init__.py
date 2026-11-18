"""Recetteur MCP : rend le serveur MCP de l'app Recetteur joignable à distance, par un webhook Home Assistant.

L'ingress de Home Assistant exige une session de navigateur : un client comme Claude (cloud) ne peut pas l'utiliser. Un webhook,
lui, est joignable sur votre adresse Nabu Casa (https://….ui.nabu.casa/api/webhook/<secret>). Cette intégration y branche un
relais vers le serveur MCP de l'app, joint par le réseau interne : le port 8100 n'a pas besoin d'être publié.
"""
from __future__ import annotations

from aiohttp import web

from homeassistant.components import webhook
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import CONF_URL, CONF_WEBHOOK_ID, DOMAIN
from .proxy import relay


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Enregistre le webhook de relais."""
    target = entry.data[CONF_URL]
    session = async_get_clientsession(hass)

    async def _handle(hass: HomeAssistant, webhook_id: str, request: web.Request) -> web.Response:
        return await relay(session, target, request)

    webhook.async_register(
        hass,
        DOMAIN,
        "Recetteur MCP",
        entry.data[CONF_WEBHOOK_ID],
        _handle,
        local_only=False,  # c'est tout l'intérêt : joignable depuis Internet
        allowed_methods=["POST"],
    )
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Retire le webhook."""
    webhook.async_unregister(hass, entry.data[CONF_WEBHOOK_ID])
    return True
