"""App « Recetteur MCP » (addon-mcp/app/start.py) : bibliothèque standard, testée hors Home Assistant."""
import importlib.util
import sys
import json
import os
import shutil
import socket
import stat
import subprocess
import tempfile
import time
from pathlib import Path

import pytest

sys.dont_write_bytecode = True  # ne pas laisser de __pycache__ dans addon-mcp/app (le test de packaging le refuse)
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("start", ROOT / "addon-mcp" / "app" / "start.py")
start = importlib.util.module_from_spec(spec)
spec.loader.exec_module(start)

pytestmark = pytest.mark.usefixtures("socket_enabled")  # le plugin Home Assistant bloque les sockets par défaut

INTEGRATION = ROOT / "custom_components" / "recetteur_mcp"
URL = "http://local-recetteur:8100/mcp"


@pytest.fixture
def dirs(tmp_path):
    config = tmp_path / "ha"
    (config / ".storage").mkdir(parents=True)
    (config / "configuration.yaml").write_text("default_config:\n")
    data = tmp_path / "data"
    data.mkdir()
    return config, data


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


# ---------------------------------------------------------------- installation
def test_install_fresh_then_unchanged_then_updated(dirs, tmp_path):
    config, _ = dirs
    src = tmp_path / "src"
    shutil.copytree(INTEGRATION, src, ignore=shutil.ignore_patterns("__pycache__"))
    dest = config / "custom_components" / "recetteur_mcp"

    assert start.install_integration(src, config) == "installed"
    assert start.tree_hash(dest) == start.tree_hash(src)
    assert start.install_integration(src, config) == "unchanged"

    (src / "proxy.py").write_text((src / "proxy.py").read_text() + "\n# nouvelle version\n")
    assert start.install_integration(src, config) == "updated"
    assert "nouvelle version" in (dest / "proxy.py").read_text()

    # une modification locale (ou un fichier ajouté) est écrasée : l'app est la source de vérité
    (dest / "proxy.py").write_text("# bidouillé")
    (dest / "intrus.py").write_text("x")
    assert start.install_integration(src, config) == "updated"
    assert not (dest / "intrus.py").exists()
    assert start.tree_hash(dest) == start.tree_hash(src)


def test_pycache_is_ignored_in_hash_and_copy(dirs, tmp_path):
    config, _ = dirs
    src = tmp_path / "src"
    shutil.copytree(INTEGRATION, src, ignore=shutil.ignore_patterns("__pycache__"))
    (src / "__pycache__").mkdir()
    (src / "__pycache__" / "x.pyc").write_bytes(b"\0")
    start.install_integration(src, config)
    assert not (config / "custom_components" / "recetteur_mcp" / "__pycache__").exists()
    dest = config / "custom_components" / "recetteur_mcp"
    (dest / "__pycache__").mkdir()
    (dest / "__pycache__" / "y.pyc").write_bytes(b"\1")  # Home Assistant compile : ce n'est pas une différence
    assert start.install_integration(src, config) == "unchanged"


def test_symlinks_are_never_followed(dirs, tmp_path):
    config, _ = dirs
    precious = tmp_path / "precieux"
    precious.mkdir()
    (precious / "important.txt").write_text("à garder")
    (config / "custom_components").mkdir()
    (config / "custom_components" / "recetteur_mcp").symlink_to(precious, target_is_directory=True)
    outside = tmp_path / "dehors.json"
    outside.write_text("intact")
    (config / "recetteur_mcp.json").symlink_to(outside)

    assert start.install_integration(INTEGRATION, config) == "updated"
    start.write_managed(config, URL, "a" * 64)
    assert (precious / "important.txt").read_text() == "à garder"   # le dossier visé par le lien n'a pas été touché
    assert outside.read_text() == "intact"                          # ni le fichier visé
    assert not (config / "custom_components" / "recetteur_mcp").is_symlink()
    assert not (config / "recetteur_mcp.json").is_symlink()
    start.remove_all(config)
    assert (precious / "important.txt").exists() and outside.exists()


def test_missing_source_is_an_error(dirs, tmp_path):
    with pytest.raises(FileNotFoundError):
        start.install_integration(tmp_path / "rien", dirs[0])


# ---------------------------------------------------------------- identifiant secret et fichier de configuration
def test_webhook_id_is_generated_once_and_kept(dirs):
    _, data = dirs
    first = start.ensure_webhook_id(data)
    assert start.is_webhook_id(first) and len(first) == 64
    assert start.ensure_webhook_id(data) == first
    assert stat.S_IMODE((data / "webhook_id.txt").stat().st_mode) == 0o600
    (data / "webhook_id.txt").write_text("corrompu")
    again = start.ensure_webhook_id(data)
    assert again != first and start.is_webhook_id(again)
    assert len({start.ensure_webhook_id(Path(tempfile.mkdtemp())) for _ in range(20)}) == 20  # vraiment aléatoire


def test_write_managed_is_idempotent_and_private(dirs):
    config, _ = dirs
    assert start.write_managed(config, URL, "b" * 64) is True
    path = config / "recetteur_mcp.json"
    assert json.loads(path.read_text()) == {"url": URL, "webhook_id": "b" * 64}
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    assert start.write_managed(config, URL, "b" * 64) is False
    assert start.write_managed(config, "http://autre:8100/mcp", "b" * 64) is True
    assert not list(config.glob("*.tmp"))


def test_what_the_app_writes_is_accepted_by_the_integration(dirs):
    """Contrat entre les deux composants : le fichier écrit par l'app est lu par l'intégration."""
    from custom_components.recetteur_mcp.managed import parse_managed

    config, data = dirs
    start.write_managed(config, URL, start.ensure_webhook_id(data))
    parsed = parse_managed((config / "recetteur_mcp.json").read_text())
    assert parsed["url"] == URL and start.is_webhook_id(parsed["webhook_id"])


@pytest.mark.parametrize(("url", "ok"), [
    ("http://local-recetteur:8100/mcp", True), ("https://h.example/mcp", True), ("http://1.2.3.4:8100/mcp", True),
    ("ftp://h/mcp", False), ("h:8100/mcp", False), ("http://", False), ("", False),
    ("http://u:p@h:8100/mcp", False), ("http://h:8100/mcp?x=1", False), ("http://h:8100/mcp#f", False), ("javascript:alert(1)", False),
])
def test_check_url(url, ok):
    assert (start.check_url(url) is None) is ok


def test_find_config_dir(tmp_path):
    assert start.find_config_dir({"RECETTEUR_MCP_CONFIG_DIR": str(tmp_path)}) == tmp_path


# ---------------------------------------------------------------- sondage
def test_probe_real_mcp_server_and_failures():
    if shutil.which("node") is None:
        pytest.skip("Node.js requis")
    port, main = _free_port(), _free_port()
    data = tempfile.mkdtemp()
    env = {**os.environ, "RECETTEUR_MCP_TOKEN": "jeton-probe-0123456789-abcdefghij", "RECETTEUR_MCP_PORT": str(port), "PORT": str(main), "RECETTEUR_DATA_DIR": data}
    proc = subprocess.Popen(["node", str(ROOT / "server" / "index.js")], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(100):
            try:
                socket.create_connection(("127.0.0.1", port), timeout=0.2).close()
                break
            except OSError:
                time.sleep(0.1)
        ok, detail = start.probe(f"http://127.0.0.1:{port}/mcp")
        assert ok and "401" in detail and "protégé" in detail   # sans jeton : actif et protégé
        ok, detail = start.probe(f"http://127.0.0.1:{port}/autre")
        assert not ok and "404" in detail
    finally:
        proc.terminate()
        proc.wait(timeout=5)
        shutil.rmtree(data, ignore_errors=True)
    ok, detail = start.probe(f"http://127.0.0.1:{port}/mcp", timeout=1)  # serveur arrêté
    assert not ok and "injoignable" in detail


# ---------------------------------------------------------------- programme complet
def _env(config, data, tmp_path, **options):
    opts = tmp_path / "options.json"
    opts.write_text(json.dumps({"recetteur_url": URL, "remote_url": "", "retirer_integration": False, **options}))
    return {"RECETTEUR_MCP_CONFIG_DIR": str(config), "RECETTEUR_MCP_DATA_DIR": str(data), "RECETTEUR_MCP_OPTIONS": str(opts), "RECETTEUR_MCP_SRC": str(INTEGRATION)}


def test_main_first_run_then_second_run(dirs, tmp_path, capsys):
    config, data = dirs
    env = _env(config, data, tmp_path, remote_url="https://abc.ui.nabu.casa/")
    assert start.main(env, watch=False) == 0
    out = capsys.readouterr().out
    assert "installée" in out and "Redémarrez Home Assistant" in out
    wid = (data / "webhook_id.txt").read_text().strip()
    assert f"https://abc.ui.nabu.casa/api/webhook/{wid}" in out   # sans double barre
    assert (config / "custom_components" / "recetteur_mcp" / "manifest.json").is_file()
    assert json.loads((config / "recetteur_mcp.json").read_text())["webhook_id"] == wid
    assert "injoignable" in out   # le serveur de test n'existe pas : signalé, sans planter

    # 2e démarrage : rien à refaire, pas de demande de redémarrage, même URL (le secret ne change pas)
    assert start.main(env, watch=False) == 0
    out = capsys.readouterr().out
    assert "déjà à jour" in out and "Redémarrez" not in out
    assert (data / "webhook_id.txt").read_text().strip() == wid

    # changement d'adresse : le fichier est réécrit et un redémarrage est demandé
    assert start.main(_env(config, data, tmp_path, recetteur_url="http://autre:8100/mcp"), watch=False) == 0
    assert "Redémarrez" in capsys.readouterr().out


def test_main_refuses_bad_url_and_missing_config(dirs, tmp_path, capsys):
    config, data = dirs
    assert start.main(_env(config, data, tmp_path, recetteur_url="ftp://x"), watch=False) == 1
    assert "recetteur_url invalide" in capsys.readouterr().out
    assert not (config / "custom_components").exists() and not (config / "recetteur_mcp.json").exists()  # rien d'écrit
    missing = {**_env(config, data, tmp_path), "RECETTEUR_MCP_CONFIG_DIR": str(tmp_path / "inexistant")}
    assert start.main(missing, watch=False) == 1
    assert "introuvable" in capsys.readouterr().out


def test_main_remove_mode(dirs, tmp_path, capsys):
    config, data = dirs
    start.main(_env(config, data, tmp_path), watch=False)
    capsys.readouterr()
    assert start.main(_env(config, data, tmp_path, retirer_integration=True), watch=False) == 0
    out = capsys.readouterr().out
    assert "Intégration retirée" in out
    assert not (config / "custom_components" / "recetteur_mcp").exists()
    assert not (config / "recetteur_mcp.json").exists()
    assert (config / "configuration.yaml").exists()   # le reste de la configuration n'est pas touché
    assert (config / ".storage").is_dir()
    start.main(_env(config, data, tmp_path, retirer_integration=True), watch=False)   # idempotent
    assert "rien à retirer" in capsys.readouterr().out


def test_only_two_places_are_written(dirs, tmp_path):
    """L'app ne touche qu'à custom_components/recetteur_mcp/ et recetteur_mcp.json dans la configuration de Home Assistant."""
    config, data = dirs
    (config / "secrets.yaml").write_text("mot_de_passe: x")
    (config / "automations.yaml").write_text("[]")
    before = {p.relative_to(config): p.read_bytes() for p in config.rglob("*") if p.is_file()}
    start.main(_env(config, data, tmp_path), watch=False)
    after = {p.relative_to(config): p.read_bytes() for p in config.rglob("*") if p.is_file()}
    added = set(after) - set(before)
    assert all(str(p) == "recetteur_mcp.json" or str(p).startswith("custom_components/recetteur_mcp/") for p in added), added
    assert all(after[p] == before[p] for p in before), "un fichier existant a été modifié"


def test_remote_url_not_http_is_ignored(dirs, tmp_path, capsys):
    config, data = dirs
    assert start.main(_env(config, data, tmp_path, remote_url="n'importe quoi"), watch=False) == 0
    out = capsys.readouterr().out
    assert "remote_url ignorée" in out and "/api/webhook/" not in out


def test_config_schema_never_uses_url_for_an_optional_empty_field():
    """Le Supervisor refuse "" pour le type `url` : seul recetteur_url (jamais vide) peut l'utiliser."""
    cfg = (ROOT / "addon-mcp" / "config.yaml").read_text()
    code = "\n".join(line.split("#")[0] for line in cfg.splitlines())
    assert "remote_url: str?" in code and "remote_url: url" not in code
