import pytest

pytest_plugins = "pytest_homeassistant_custom_component"


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations):
    """Charge custom_components/ dans le Home Assistant de test."""
    return


@pytest.fixture(autouse=True)
def clean_managed_file(hass):
    """Le dossier de configuration du Home Assistant de test est partagé : on retire recetteur_mcp.json avant et après chaque test."""
    import os

    path = hass.config.path("recetteur_mcp.json")
    if os.path.exists(path):
        os.remove(path)
    yield
    if os.path.exists(path):
        os.remove(path)
