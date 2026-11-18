"""Aides communes (assistant de configuration et mode géré)."""
from __future__ import annotations

from homeassistant.components import webhook
from homeassistant.core import HomeAssistant
from homeassistant.helpers.network import NoURLAvailableError


def webhook_url(hass: HomeAssistant, webhook_id: str) -> str:
    """URL publique du webhook (adresse Nabu Casa ou externe) ; un modèle si Home Assistant n'en connaît pas."""
    try:
        return webhook.async_generate_url(hass, webhook_id, allow_internal=False, allow_ip=False)
    except NoURLAvailableError:
        return f"https://VOTRE-ADRESSE-EXTERNE/api/webhook/{webhook_id}"
