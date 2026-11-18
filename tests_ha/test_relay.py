"""Relais webhook → serveur MCP (aiohttp simulé : on vérifie exactement ce qui est transmis, et ce qui ne l'est pas)."""
import asyncio

import aiohttp
import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.recetteur_mcp.const import CONF_URL, CONF_WEBHOOK_ID, DOMAIN
from custom_components.recetteur_mcp.proxy import MAX_BODY

TARGET = "http://local-recetteur:8100/mcp"
WID = "test-webhook-id-0123456789abcdef0123"
RPC = {"jsonrpc": "2.0", "id": 1, "method": "ping"}


@pytest.fixture
async def entry(hass):
    e = MockConfigEntry(domain=DOMAIN, data={CONF_URL: TARGET, CONF_WEBHOOK_ID: WID})
    e.add_to_hass(hass)
    assert await hass.config_entries.async_setup(e.entry_id)
    await hass.async_block_till_done()
    return e


async def test_forwards_request_and_response(hass, hass_client_no_auth, aioclient_mock, entry):
    aioclient_mock.post(TARGET, json={"jsonrpc": "2.0", "id": 1, "result": {}}, headers={"Content-Type": "application/json", "X-Interne": "secret"})
    client = await hass_client_no_auth()
    resp = await client.post(
        f"/api/webhook/{WID}",
        json=RPC,
        headers={"Authorization": "Bearer le-jeton", "MCP-Protocol-Version": "2025-06-18", "Cookie": "ha=1", "X-Evil": "1"},
    )
    assert resp.status == 200
    assert await resp.json() == {"jsonrpc": "2.0", "id": 1, "result": {}}
    assert "X-Interne" not in resp.headers  # liste blanche en réponse aussi

    assert aioclient_mock.call_count == 1
    _, url, data, headers = aioclient_mock.mock_calls[0]
    assert str(url) == TARGET
    assert headers["Authorization"] == "Bearer le-jeton"
    assert headers["MCP-Protocol-Version"] == "2025-06-18"
    # ni cookies, ni en-têtes arbitraires : seule une liste blanche traverse
    assert not {"Cookie", "X-Evil"} & set(headers)


async def test_passes_auth_errors_through(hass, hass_client_no_auth, aioclient_mock, entry):
    """Le jeton est vérifié par le serveur MCP, pas par le relais : son 401 (et son en-tête) traversent."""
    aioclient_mock.post(TARGET, status=401, json={"error": "Jeton absent ou invalide."}, headers={"Content-Type": "application/json", "WWW-Authenticate": 'Bearer realm="recetteur"'})
    resp = await (await hass_client_no_auth()).post(f"/api/webhook/{WID}", json=RPC)
    assert resp.status == 401
    assert resp.headers["WWW-Authenticate"] == 'Bearer realm="recetteur"'
    assert (await resp.json())["error"] == "Jeton absent ou invalide."


async def test_notification_202(hass, hass_client_no_auth, aioclient_mock, entry):
    aioclient_mock.post(TARGET, status=202, text="")
    resp = await (await hass_client_no_auth()).post(f"/api/webhook/{WID}", json={"jsonrpc": "2.0", "method": "notifications/initialized"})
    assert resp.status == 202


async def test_browser_origin_refused(hass, hass_client_no_auth, aioclient_mock, entry):
    resp = await (await hass_client_no_auth()).post(f"/api/webhook/{WID}", json=RPC, headers={"Origin": "https://evil.example"})
    assert resp.status == 403
    assert aioclient_mock.call_count == 0  # rien n'a été transmis


async def test_only_post(hass, hass_client_no_auth, aioclient_mock, entry):
    client = await hass_client_no_auth()
    for method in ("get", "put", "delete"):
        resp = await getattr(client, method)(f"/api/webhook/{WID}")
        assert resp.status == 405, method
    assert aioclient_mock.call_count == 0


async def test_unknown_webhook_forwards_nothing(hass, hass_client_no_auth, aioclient_mock, entry):
    await (await hass_client_no_auth()).post("/api/webhook/pas-le-bon-identifiant", json=RPC)
    assert aioclient_mock.call_count == 0


async def test_oversized_body_refused(hass, hass_client_no_auth, aioclient_mock, entry):
    resp = await (await hass_client_no_auth()).post(f"/api/webhook/{WID}", data=b"x" * (MAX_BODY + 1), headers={"Content-Type": "application/json"})
    assert resp.status == 413
    assert aioclient_mock.call_count == 0


@pytest.mark.parametrize(("exc", "status"), [(aiohttp.ClientError("connexion refusée par 172.30.33.5"), 502), (asyncio.TimeoutError(), 504)])
async def test_server_down_does_not_leak_internals(hass, hass_client_no_auth, aioclient_mock, entry, exc, status):
    aioclient_mock.post(TARGET, exc=exc)
    resp = await (await hass_client_no_auth()).post(f"/api/webhook/{WID}", json=RPC)
    assert resp.status == status
    body = await resp.text()
    assert "172.30" not in body and "local-recetteur" not in body  # ni adresse interne ni nom d'hôte


async def test_unload_removes_webhook(hass, hass_client_no_auth, aioclient_mock, entry):
    assert await hass.config_entries.async_unload(entry.entry_id)
    await (await hass_client_no_auth()).post(f"/api/webhook/{WID}", json=RPC)
    assert aioclient_mock.call_count == 0
