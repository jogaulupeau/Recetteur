"""De bout en bout : le vrai serveur MCP de Recetteur (Node) derrière le relais, dans un vrai Home Assistant de test."""
import os
import shutil
import socket
import subprocess
import tempfile
import time
from pathlib import Path

import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.recetteur_mcp.const import CONF_URL, CONF_WEBHOOK_ID, DOMAIN

ROOT = Path(__file__).resolve().parents[1]
TOKEN = "jeton-e2e-0123456789-abcdefghijklmnop"
WID = "e2e-webhook-id-0123456789abcdef0123456789"

pytestmark = [pytest.mark.skipif(shutil.which("node") is None, reason="Node.js requis"), pytest.mark.usefixtures("socket_enabled")]


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture
def recetteur():
    """Lance le vrai serveur Recetteur (MCP activé) sur des ports libres."""
    main, mcp = _free_port(), _free_port()
    data = tempfile.mkdtemp(prefix="recetteur-e2e-")
    env = {**os.environ, "RECETTEUR_MCP_TOKEN": TOKEN, "RECETTEUR_MCP_PORT": str(mcp), "PORT": str(main), "RECETTEUR_DATA_DIR": data, "RECETTEUR_VERSION": "e2e"}
    proc = subprocess.Popen(["node", str(ROOT / "server" / "index.js")], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    try:
        for _ in range(100):
            try:
                socket.create_connection(("127.0.0.1", mcp), timeout=0.2).close()
                break
            except OSError:
                time.sleep(0.1)
        else:
            raise RuntimeError("le serveur Recetteur n'a pas démarré")
        yield f"http://127.0.0.1:{mcp}/mcp"
    finally:
        proc.terminate()
        proc.wait(timeout=5)
        shutil.rmtree(data, ignore_errors=True)


async def test_claude_through_the_webhook(hass, hass_client_no_auth, recetteur):
    entry = MockConfigEntry(domain=DOMAIN, data={CONF_URL: recetteur, CONF_WEBHOOK_ID: WID})
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    client = await hass_client_no_auth()
    url = f"/api/webhook/{WID}"
    auth = {"Authorization": f"Bearer {TOKEN}"}

    # initialize, comme le ferait Claude
    resp = await client.post(url, headers=auth, json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "e2e", "version": "1"}}})
    assert resp.status == 200
    result = (await resp.json())["result"]
    assert result["serverInfo"]["name"] == "recetteur" and result["protocolVersion"] == "2025-06-18"

    # liste des outils
    resp = await client.post(url, headers=auth, json={"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
    assert len((await resp.json())["result"]["tools"]) == 17

    # création d'une recette puis lecture avec quantités ajustées : un vrai aller-retour
    recette = {"titre": "Omelette", "portions": 2, "ingredients": [{"id": "o", "nom": "œuf", "quantite": 6}], "etapes": [{"texte": "Battre {{o}} œufs.", "ingredients": ["o"]}]}
    resp = await client.post(url, headers=auth, json={"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "ajouter_recettes", "arguments": {"recettes": [recette]}}})
    assert "Import terminé : 1 nouvelle" in (await resp.json())["result"]["content"][0]["text"]
    resp = await client.post(url, headers=auth, json={"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {"name": "lire_recette", "arguments": {"id": "omelette", "personnes": 4}}})
    assert "- 12 œufs" in (await resp.json())["result"]["content"][0]["text"]

    # sans jeton, ou avec un faux : le serveur MCP refuse (le relais ne l'a pas contourné)
    resp = await client.post(url, json={"jsonrpc": "2.0", "id": 5, "method": "ping"})
    assert resp.status == 401 and "Bearer" in resp.headers["WWW-Authenticate"]
    resp = await client.post(url, headers={"Authorization": "Bearer faux-faux-faux-faux-faux-faux"}, json={"jsonrpc": "2.0", "id": 6, "method": "ping"})
    assert resp.status == 401
