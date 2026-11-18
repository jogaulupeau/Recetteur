"""Mode géré : l'app « Recetteur MCP » écrit recetteur_mcp.json, l'intégration l'importe toute seule."""
import json
from unittest.mock import patch

import pytest
from homeassistant.setup import async_setup_component

from custom_components.recetteur_mcp.const import CONF_URL, CONF_WEBHOOK_ID, DOMAIN, MANAGED_FILE
from custom_components.recetteur_mcp.managed import parse_managed

TARGET = "http://local-recetteur:8100/mcp"
WID = "a" * 64
RPC = {"jsonrpc": "2.0", "id": 1, "method": "ping"}


def _write(hass, content):
    path = hass.config.path(MANAGED_FILE)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(content if isinstance(content, str) else json.dumps(content))


async def _setup(hass):
    assert await async_setup_component(hass, DOMAIN, {})
    await hass.async_block_till_done()


async def test_file_creates_entry_and_webhook(hass, hass_client_no_auth, aioclient_mock):
    _write(hass, {"url": TARGET, "webhook_id": WID})
    aioclient_mock.post(TARGET, status=200, json={"jsonrpc": "2.0", "id": 1, "result": {}}, headers={"Content-Type": "application/json"})
    with patch("custom_components.recetteur_mcp.persistent_notification.async_create") as notify:
        await _setup(hass)
    entries = hass.config_entries.async_entries(DOMAIN)
    assert len(entries) == 1
    assert dict(entries[0].data) == {CONF_URL: TARGET, CONF_WEBHOOK_ID: WID}
    # l'URL à donner à Claude est annoncée (avec le secret : notification réservée aux administrateurs)
    assert notify.call_count == 1
    assert f"/api/webhook/{WID}" in notify.call_args.args[1]
    assert notify.call_args.kwargs["notification_id"] == "recetteur_mcp_url"
    # et le relais fonctionne, sans aucune saisie
    resp = await (await hass_client_no_auth()).post(f"/api/webhook/{WID}", json=RPC)
    assert resp.status == 200


async def test_no_file_does_nothing(hass):
    await _setup(hass)
    assert hass.config_entries.async_entries(DOMAIN) == []


@pytest.mark.parametrize("content", ["pas du json", "[]", "{}", {"url": TARGET}, {"webhook_id": WID},
                                     {"url": "ftp://x/mcp", "webhook_id": WID}, {"url": TARGET, "webhook_id": "court"},
                                     {"url": "http://user:pass@h:8100/mcp", "webhook_id": WID},
                                     {"url": "http://h:8100/mcp?x=1", "webhook_id": WID},
                                     {"url": TARGET, "webhook_id": "../../etc/passwd" + "a" * 40}])
async def test_invalid_file_is_ignored(hass, content):
    _write(hass, content)
    await _setup(hass)
    assert hass.config_entries.async_entries(DOMAIN) == []


async def test_file_change_updates_entry_and_moves_webhook(hass, hass_client_no_auth, aioclient_mock):
    aioclient_mock.post(TARGET, status=200, json={}, headers={"Content-Type": "application/json"})
    aioclient_mock.post("http://autre:8100/mcp", status=200, json={}, headers={"Content-Type": "application/json"})
    _write(hass, {"url": TARGET, "webhook_id": WID})
    await _setup(hass)
    entry = hass.config_entries.async_entries(DOMAIN)[0]

    # même fichier au redémarrage suivant : rien ne bouge, aucune nouvelle notification
    with patch("custom_components.recetteur_mcp.persistent_notification.async_create") as notify:
        data = {"url": "http://autre:8100/mcp", "webhook_id": "b" * 64}
        from custom_components.recetteur_mcp import _sync_managed
        await _sync_managed(hass, {CONF_URL: TARGET, CONF_WEBHOOK_ID: WID})
        assert notify.call_count == 0
        # fichier modifié : l'entrée est mise à jour, l'ancien webhook disparaît, le nouveau fonctionne
        await _sync_managed(hass, data)
        await hass.async_block_till_done()
        assert notify.call_count == 1
    assert hass.config_entries.async_entries(DOMAIN) == [entry]  # la même entrée, pas un doublon
    assert dict(entry.data) == data
    client = await hass_client_no_auth()
    calls = aioclient_mock.call_count
    await client.post(f"/api/webhook/{WID}", json=RPC)
    assert aioclient_mock.call_count == calls  # ancien identifiant : plus rien n'est relayé
    resp = await client.post(f"/api/webhook/{'b' * 64}", json=RPC)
    assert resp.status == 200 and aioclient_mock.call_count == calls + 1
    assert str(aioclient_mock.mock_calls[-1][1]) == "http://autre:8100/mcp"


async def test_import_refuses_second_entry_and_bad_data(hass):
    from homeassistant.config_entries import SOURCE_IMPORT
    bad = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_IMPORT}, data={"url": "ftp://x", "webhook_id": WID})
    assert bad["type"].value == "abort" and bad["reason"] == "invalid_import"
    ok = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_IMPORT}, data={CONF_URL: TARGET, CONF_WEBHOOK_ID: WID})
    assert ok["type"].value == "create_entry"
    again = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_IMPORT}, data={CONF_URL: TARGET, CONF_WEBHOOK_ID: WID})
    assert again["reason"] == "single_instance_allowed"


def test_parse_managed_accepts_a_good_file():
    assert parse_managed(json.dumps({"url": "https://h.example/mcp", "webhook_id": "x" * 40, "ignore": 1})) == {"url": "https://h.example/mcp", "webhook_id": "x" * 40}


async def test_add_integration_from_ui_needs_no_input_when_managed(hass, hass_client_no_auth, aioclient_mock):
    """Cas réel : Home Assistant ne charge pas l'intégration sans entrée ni ligne YAML ; on l'ajoute une fois par l'interface."""
    _write(hass, {"url": TARGET, "webhook_id": WID})
    aioclient_mock.post(TARGET, status=200, json={"jsonrpc": "2.0", "id": 1, "result": {}}, headers={"Content-Type": "application/json"})
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": "user"})
    assert result["type"] == "form" and result["step_id"] == "done"        # pas de saisie de l'adresse
    assert f"/api/webhook/{WID}" in result["description_placeholders"]["url"]  # l'URL déjà connue de l'utilisateur est conservée
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {})
    assert result["type"] == "create_entry"
    assert dict(result["data"]) == {CONF_URL: TARGET, CONF_WEBHOOK_ID: WID}
    await hass.async_block_till_done()
    assert (await (await hass_client_no_auth()).post(f"/api/webhook/{WID}", json=RPC)).status == 200
    assert aioclient_mock.call_count == 1


async def test_yaml_line_enables_automatic_import(hass):
    _write(hass, {"url": TARGET, "webhook_id": WID})
    assert await async_setup_component(hass, DOMAIN, {DOMAIN: {}})   # `recetteur_mcp:` dans configuration.yaml
    await hass.async_block_till_done()
    assert len(hass.config_entries.async_entries(DOMAIN)) == 1


async def test_without_file_the_ui_still_asks_for_the_address(hass):
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": "user"})
    assert result["type"] == "form" and result["step_id"] == "user"
