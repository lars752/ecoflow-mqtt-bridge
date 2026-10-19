"""Gemeinsame Fixtures für die Tests der Integration."""

import pytest


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations):
    """Benutzerdefinierte Integrationen in den Tests aktivieren."""
    yield


@pytest.fixture
def expected_lingering_timers() -> bool:
    """Der periodische Timer der MQTT-Integration läuft nach den Tests noch (bekannt, harmlos)."""
    return True
