#!/usr/bin/env python3
"""App « Recetteur MCP » : installe l'intégration de relais dans Home Assistant et la configure.

Ce que fait l'app (et rien d'autre) :
  1. copie l'intégration `recetteur_mcp` dans <config HA>/custom_components/ (si absente ou différente) ;
  2. génère une fois l'identifiant secret du webhook (/data/webhook_id.txt) ;
  3. écrit <config HA>/recetteur_mcp.json {url, webhook_id}, que l'intégration importe au démarrage de Home Assistant ;
  4. surveille que le serveur MCP de l'app Recetteur répond, et le journalise.

Elle n'écrit que ces deux emplacements dans la configuration de Home Assistant, et ne lit rien d'autre. Ce privilège (écriture dans la
configuration) est la raison d'être d'une app séparée : l'app Recetteur, elle, n'en a aucun.
Bibliothèque standard uniquement.
"""
from __future__ import annotations

import hashlib
import json
import os
import secrets
import shutil
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

DOMAIN = "recetteur_mcp"
MANAGED_FILE = "recetteur_mcp.json"
WEBHOOK_ID_FILE = "webhook_id.txt"
PING = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "ping"}).encode()
IGNORED = {"__pycache__"}


def log(level: str, message: str) -> None:
    print(f"[{level}] {message}", flush=True)


# ------------------------------------------------------------------ validation
def check_url(url: str) -> str | None:
    """None si l'adresse du serveur MCP est acceptable, sinon la raison."""
    try:
        parsed = urlparse(url)
    except ValueError as err:
        return str(err)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return "l'adresse doit commencer par http:// ou https:// et contenir un nom d'hôte"
    if parsed.username or parsed.password:
        return "l'adresse ne doit pas contenir d'identifiants"
    if parsed.query or parsed.fragment:
        return "l'adresse ne doit contenir ni paramètres ni fragment"
    return None


def is_webhook_id(value: str) -> bool:
    return len(value) == 64 and set(value) <= set("0123456789abcdef")


# ------------------------------------------------------------------ dossier de configuration
def find_config_dir(env: dict[str, str] | None = None) -> Path | None:
    """Dossier de configuration de Home Assistant, tel que monté dans l'app (`homeassistant_config`).

    Le point de montage dépend de la version du Supervisor : on le reconnaît à son contenu plutôt que de le supposer.
    """
    env = os.environ if env is None else env
    if env.get("RECETTEUR_MCP_CONFIG_DIR"):
        return Path(env["RECETTEUR_MCP_CONFIG_DIR"])
    for candidate in ("/homeassistant", "/config"):
        p = Path(candidate)
        if (p / "configuration.yaml").is_file() or (p / ".storage").is_dir():
            return p
    return None


# ------------------------------------------------------------------ installation de l'intégration
def tree_hash(root: Path) -> str:
    """Empreinte du contenu d'un dossier (noms + octets), hors __pycache__."""
    h = hashlib.sha256()
    for path in sorted(root.rglob("*")):
        rel = path.relative_to(root)
        if IGNORED & set(rel.parts) or not path.is_file() or path.is_symlink():
            continue
        h.update(str(rel).encode() + b"\0" + path.read_bytes() + b"\0")
    return h.hexdigest()


def install_integration(src: Path, config_dir: Path) -> str:
    """Copie l'intégration ; retourne « installed », « updated » ou « unchanged »."""
    if not (src / "manifest.json").is_file():
        raise FileNotFoundError(f"intégration introuvable dans l'image : {src}")
    dest = config_dir / "custom_components" / DOMAIN
    existed = dest.exists() or dest.is_symlink()
    if existed and not dest.is_symlink() and dest.is_dir() and tree_hash(dest) == tree_hash(src):
        return "unchanged"
    dest.parent.mkdir(parents=True, exist_ok=True)
    staging = dest.with_name(f"{DOMAIN}.installing")
    shutil.rmtree(staging, ignore_errors=True)
    shutil.copytree(src, staging, ignore=shutil.ignore_patterns(*IGNORED))
    if dest.is_symlink() or dest.is_file():
        dest.unlink()  # un lien symbolique est retiré, jamais suivi : la cible n'est pas touchée
    elif dest.exists():
        shutil.rmtree(dest)
    staging.rename(dest)
    return "updated" if existed else "installed"


def ensure_webhook_id(data_dir: Path) -> str:
    """Identifiant secret du webhook : tiré une fois (256 bits), puis conservé d'un redémarrage à l'autre."""
    path = data_dir / WEBHOOK_ID_FILE
    try:
        current = path.read_text(encoding="utf-8").strip()
        if is_webhook_id(current):
            return current
    except FileNotFoundError:
        pass
    data_dir.mkdir(parents=True, exist_ok=True)
    wid = secrets.token_hex(32)
    path.write_text(wid + "\n", encoding="utf-8")
    path.chmod(0o600)
    return wid


def write_managed(config_dir: Path, url: str, webhook_id: str) -> bool:
    """Écrit le fichier lu par l'intégration ; True s'il a changé."""
    path = config_dir / MANAGED_FILE
    content = json.dumps({"url": url, "webhook_id": webhook_id}, indent=2) + "\n"
    try:
        if path.read_text(encoding="utf-8") == content:
            return False
    except (FileNotFoundError, OSError):
        pass
    tmp = path.with_name(MANAGED_FILE + ".tmp")
    tmp.write_text(content, encoding="utf-8")
    tmp.chmod(0o600)
    os.replace(tmp, path)  # remplace un éventuel lien symbolique lui-même, sans le suivre
    return True


def remove_all(config_dir: Path) -> list[str]:
    """Retire l'intégration et le fichier de configuration. Retourne ce qui a été retiré."""
    removed = []
    dest = config_dir / "custom_components" / DOMAIN
    if dest.is_symlink() or dest.is_file():
        dest.unlink()
        removed.append(str(dest))
    elif dest.is_dir():
        shutil.rmtree(dest)
        removed.append(str(dest))
    managed = config_dir / MANAGED_FILE
    if managed.exists() or managed.is_symlink():
        managed.unlink()
        removed.append(str(managed))
    return removed


# ------------------------------------------------------------------ surveillance
def probe(url: str, timeout: float = 5.0) -> tuple[bool, str]:
    """Le serveur MCP répond-il ? Sans jeton, un 401 est la bonne réponse : il est actif et protégé."""
    req = urllib.request.Request(url, data=PING, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 - adresse validée (http/https)
            return True, f"répond (HTTP {resp.status})"
    except urllib.error.HTTPError as err:
        if err.code == 401:
            return True, "répond et exige un jeton (HTTP 401) : actif et protégé"
        return False, f"répond mais avec une erreur (HTTP {err.code})"
    except (urllib.error.URLError, TimeoutError, OSError) as err:
        reason = getattr(err, "reason", err)
        return False, f"injoignable ({reason})"


# ------------------------------------------------------------------ programme
def load_options(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def main(env: dict[str, str] | None = None, watch: bool = True) -> int:
    env = dict(os.environ if env is None else env)
    opts = load_options(Path(env.get("RECETTEUR_MCP_OPTIONS", "/data/options.json")))
    data_dir = Path(env.get("RECETTEUR_MCP_DATA_DIR", "/data"))
    src = Path(env.get("RECETTEUR_MCP_SRC", "/opt/integration/recetteur_mcp"))

    config_dir = find_config_dir(env)
    if config_dir is None or not config_dir.is_dir():
        log("ERREUR", "Dossier de configuration de Home Assistant introuvable : l'app doit pouvoir le monter (map : homeassistant_config).")
        return 1

    if opts.get("retirer_integration"):
        removed = remove_all(config_dir)
        log("INFO", "Intégration retirée : " + (", ".join(removed) if removed else "rien à retirer") + ".")
        log("INFO", "Redémarrez Home Assistant, supprimez l'entrée « Recetteur MCP » si elle existe, puis désinstallez cette app.")
        return 0

    url = str(opts.get("recetteur_url", "")).strip()
    problem = check_url(url)
    if problem:
        log("ERREUR", f"Option recetteur_url invalide : {problem}.")
        return 1

    try:
        status = install_integration(src, config_dir)
        webhook_id = ensure_webhook_id(data_dir)
        changed = write_managed(config_dir, url, webhook_id)
    except OSError as err:
        log("ERREUR", f"Écriture dans la configuration de Home Assistant impossible : {err}")
        return 1

    labels = {"installed": "installée", "updated": "mise à jour", "unchanged": "déjà à jour"}
    log("INFO", f"Intégration recetteur_mcp : {labels[status]}. Serveur MCP visé : {url}")
    if status != "unchanged" or changed:
        log("ATTENTION", "Redémarrez Home Assistant (Paramètres → Système → Redémarrer) pour que l'intégration soit chargée avec cette configuration.")
        log("INFO", "Une notification « Recetteur MCP » donnera ensuite l'URL à saisir dans Claude.")
    remote = str(opts.get("remote_url", "")).strip().rstrip("/")
    if remote:
        log("INFO", f"URL à donner à Claude (secret : ne la partagez pas) : {remote}/api/webhook/{webhook_id}")

    ok, detail = probe(url)
    log("INFO" if ok else "ATTENTION", f"Serveur MCP de Recetteur : {detail}")
    if not ok:
        log("ATTENTION", "Vérifiez le nom d'hôte (page « Informations » de l'app Recetteur), que l'app tourne, et que son option mcp_token est renseignée.")
    while watch:
        time.sleep(60)
        now_ok, now_detail = probe(url)
        if now_ok != ok:
            log("INFO" if now_ok else "ATTENTION", f"Serveur MCP de Recetteur : {now_detail}")
            ok = now_ok
    return 0


if __name__ == "__main__":
    sys.exit(main())
