"""Assistant de configuration."""
import aiohttp
from homeassistant.data_entry_flow import FlowResultType

from custom_components.recetteur_mcp.const import CONF_URL, CONF_WEBHOOK_ID, DOMAIN

TARGET = "http://local-recetteur:8100/mcp"


async def _start(hass):
    return await hass.config_entries.flow.async_init(DOMAIN, context={"source": "user"})


async def test_flow_creates_entry_and_shows_url(hass, aioclient_mock):
    """401 sans jeton = serveur actif et protégé : la configuration aboutit, et l'URL du webhook est affichée."""
    hass.config.external_url = "https://abcdef.ui.nabu.casa"
    aioclient_mock.post(TARGET, status=401, json={"error": "Jeton absent ou invalide."})
    result = await _start(hass)
    assert result["type"] is FlowResultType.FORM and result["step_id"] == "user"

    result = await hass.config_entries.flow.async_configure(result["flow_id"], {CONF_URL: TARGET})
    assert result["type"] is FlowResultType.FORM and result["step_id"] == "done"
    url = result["description_placeholders"]["url"]
    assert url.startswith("https://abcdef.ui.nabu.casa/api/webhook/")
    webhook_id = url.rsplit("/", 1)[1]
    assert len(webhook_id) == 64  # 256 bits d’aléa : impossible à deviner

    result = await hass.config_entries.flow.async_configure(result["flow_id"], {})
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["data"] == {CONF_URL: TARGET, CONF_WEBHOOK_ID: webhook_id}


async def test_flow_without_external_url_still_works(hass, aioclient_mock):
    aioclient_mock.post(TARGET, status=200, json={"jsonrpc": "2.0", "id": 1, "result": {}})
    result = await hass.config_entries.flow.async_configure((await _start(hass))["flow_id"], {CONF_URL: TARGET})
    assert result["step_id"] == "done"
    assert "/api/webhook/" in result["description_placeholders"]["url"]


async def test_flow_unreachable(hass, aioclient_mock):
    aioclient_mock.post(TARGET, exc=aiohttp.ClientError("refusée"))
    result = await hass.config_entries.flow.async_configure((await _start(hass))["flow_id"], {CONF_URL: TARGET})
    assert result["type"] is FlowResultType.FORM
    assert result["errors"] == {"base": "cannot_connect"}


async def test_flow_server_error_is_not_ok(hass, aioclient_mock):
    aioclient_mock.post(TARGET, status=500)
    result = await hass.config_entries.flow.async_configure((await _start(hass))["flow_id"], {CONF_URL: TARGET})
    assert result["errors"] == {"base": "cannot_connect"}


async def test_flow_invalid_url(hass):
    for bad in ("ftp://x/mcp", "pas une url", "http://"):
        result = await hass.config_entries.flow.async_configure((await _start(hass))["flow_id"], {CONF_URL: bad})
        assert result["errors"] == {CONF_URL: "invalid_url"}, bad


async def test_single_instance(hass, aioclient_mock):
    aioclient_mock.post(TARGET, status=401, json={})
    result = await hass.config_entries.flow.async_configure((await _start(hass))["flow_id"], {CONF_URL: TARGET})
    await hass.config_entries.flow.async_configure(result["flow_id"], {})
    again = await _start(hass)
    assert again["type"] is FlowResultType.ABORT and again["reason"] == "single_instance_allowed"
