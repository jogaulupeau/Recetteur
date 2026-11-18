"""Lecture du fichier de configuration écrit par l'app « Recetteur MCP » (module sans dépendance à Home Assistant)."""
from __future__ import annotations

import json
import logging
import re
from typing import Any
from urllib.parse import urlparse

_LOGGER = logging.getLogger(__name__)

WEBHOOK_ID_RE = re.compile(r"^[A-Za-z0-9_-]{32,128}$")


def parse_managed(raw: str) -> dict[str, str]:
    """Valide le contenu du fichier ; lève ValueError avec un message clair."""
    try:
        data: Any = json.loads(raw)
    except json.JSONDecodeError as err:
        raise ValueError(f"JSON invalide : {err}") from err
    if not isinstance(data, dict):
        raise ValueError("un objet JSON est attendu")
    url, webhook_id = data.get("url"), data.get("webhook_id")
    if not isinstance(url, str):
        raise ValueError("« url » manquante")
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ValueError("« url » doit être une adresse http(s)")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("« url » ne doit contenir ni identifiants, ni paramètres, ni fragment")
    if not isinstance(webhook_id, str) or not WEBHOOK_ID_RE.match(webhook_id):
        raise ValueError("« webhook_id » invalide (32 à 128 caractères : lettres, chiffres, - et _)")
    return {"url": url, "webhook_id": webhook_id}


def read_managed(path: str) -> dict[str, str] | None:
    """None si le fichier n'existe pas ou est invalide (l'erreur est journalisée)."""
    try:
        with open(path, encoding="utf-8") as fh:
            raw = fh.read(65536)
    except FileNotFoundError:
        return None
    except OSError as err:
        _LOGGER.error("Recetteur MCP : lecture de %s impossible : %s", path, err)
        return None
    try:
        return parse_managed(raw)
    except ValueError as err:
        _LOGGER.error("Recetteur MCP : %s ignoré (%s)", path, err)
        return None
