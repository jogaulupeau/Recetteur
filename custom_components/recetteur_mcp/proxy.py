"""Relais d'une requête MCP vers le serveur MCP de l'app Recetteur.

Module volontairement indépendant de Home Assistant (aiohttp seul) : il se teste sans lui.

Sécurité : le webhook est une porte ouverte sur Internet (via Nabu Casa) ; l'identifiant secret du webhook est une première
barrière, le jeton Bearer du serveur MCP une seconde (il est exigé par le serveur MCP lui-même : ce relais ne le vérifie pas
et ne le journalise jamais). Seuls quelques en-têtes sont transmis, ni cookies ni en-têtes arbitraires.
"""
from __future__ import annotations

import asyncio
import logging

from aiohttp import ClientError, ClientSession, ClientTimeout, web

_LOGGER = logging.getLogger(__name__)

MAX_BODY = 4 * 1024 * 1024  # même limite que le serveur MCP
MAX_RESPONSE = 8 * 1024 * 1024
TIMEOUT = ClientTimeout(total=30)

# En-têtes transmis dans chaque sens (liste blanche).
FORWARD_REQUEST = {"authorization", "content-type", "accept", "mcp-protocol-version"}
FORWARD_RESPONSE = {"content-type", "www-authenticate", "retry-after", "allow"}


def _error(status: int, message: str, headers: dict[str, str] | None = None) -> web.Response:
    return web.json_response({"error": message}, status=status, headers=headers)


async def relay(session: ClientSession, target: str, request: web.Request) -> web.Response:
    """Transmet la requête au serveur MCP et renvoie sa réponse telle quelle."""
    if request.method != "POST":
        return _error(405, "POST uniquement.", {"Allow": "POST"})
    # Comme le serveur MCP (spécification MCP) : un navigateur qui cible cette URL est refusé.
    if request.headers.get("Origin"):
        return _error(403, "Origine refusée.")
    if (request.content_length or 0) > MAX_BODY:
        return _error(413, "Requête trop volumineuse.")
    body = await request.content.read(MAX_BODY + 1)
    if len(body) > MAX_BODY:
        return _error(413, "Requête trop volumineuse.")

    headers = {k: v for k, v in request.headers.items() if k.lower() in FORWARD_REQUEST}
    try:
        async with session.post(target, data=body, headers=headers, timeout=TIMEOUT, allow_redirects=False) as resp:
            data = await resp.content.read(MAX_RESPONSE + 1)
            if len(data) > MAX_RESPONSE:
                return _error(502, "Réponse trop volumineuse.")
            out = {k: v for k, v in resp.headers.items() if k.lower() in FORWARD_RESPONSE}
            return web.Response(status=resp.status, body=data, headers=out)
    except asyncio.TimeoutError:
        return _error(504, "Le serveur MCP de Recetteur ne répond pas.")
    except ClientError as err:
        # Le détail (nom d'hôte interne, port) reste dans le journal de Home Assistant, pas dans la réponse.
        _LOGGER.warning("Serveur MCP de Recetteur injoignable (%s) : %s", target, err)
        return _error(502, "Serveur MCP de Recetteur injoignable.")
