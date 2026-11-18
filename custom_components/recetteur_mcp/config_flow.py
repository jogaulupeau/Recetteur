"""Configuration de l'intégration Recetteur MCP : adresse du serveur MCP, puis affichage de l'URL à donner à Claude."""
from __future__ import annotations

from typing import Any
from urllib.parse import urlparse

import voluptuous as vol

from homeassistant.components import webhook
from homeassistant.config_entries import ConfigFlow, ConfigFlowResult
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.network import NoURLAvailableError

from .const import CONF_URL, CONF_WEBHOOK_ID, DEFAULT_URL, DOMAIN

PING = {"jsonrpc": "2.0", "id": 1, "method": "ping"}


class RecetteurMcpConfigFlow(ConfigFlow, domain=DOMAIN):
    """Assistant de configuration."""

    VERSION = 1

    def __init__(self) -> None:
        self._url: str = ""
        self._webhook_id: str = ""

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Demande l'adresse interne du serveur MCP et vérifie qu'il répond."""
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")
        errors: dict[str, str] = {}
        if user_input is not None:
            url = user_input[CONF_URL].strip()
            parsed = urlparse(url)
            if parsed.scheme not in ("http", "https") or not parsed.hostname:
                errors[CONF_URL] = "invalid_url"
            elif not await self._reachable(url):
                errors["base"] = "cannot_connect"
            else:
                self._url = url
                self._webhook_id = webhook.async_generate_id()
                return await self.async_step_done()
        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema({vol.Required(CONF_URL, default=DEFAULT_URL): str}),
            errors=errors,
        )

    async def async_step_done(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Affiche l'URL du webhook : c'est celle à saisir dans le connecteur de Claude."""
        if user_input is not None:
            return self.async_create_entry(
                title="Recetteur MCP",
                data={CONF_URL: self._url, CONF_WEBHOOK_ID: self._webhook_id},
            )
        try:
            url = webhook.async_generate_url(self.hass, self._webhook_id, allow_internal=False, allow_ip=False)
        except NoURLAvailableError:
            url = f"https://VOTRE-ADRESSE-EXTERNE/api/webhook/{self._webhook_id}"
        return self.async_show_form(step_id="done", description_placeholders={"url": url})

    async def _reachable(self, url: str) -> bool:
        """Le serveur doit répondre (401 sans jeton : c'est la preuve qu'il est actif et protégé)."""
        try:
            async with async_get_clientsession(self.hass).post(
                url, json=PING, timeout=10, allow_redirects=False
            ) as resp:
                return resp.status in (200, 401)
        except Exception:  # noqa: BLE001 - toute erreur réseau = injoignable
            return False
