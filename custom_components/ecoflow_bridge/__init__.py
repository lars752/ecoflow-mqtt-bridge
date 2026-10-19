"""EcoFlow: Geräte des Add-ons „EcoFlow MQTT Bridge“ als Hub mit Geräten und Entitäten."""

from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant

from .hub import EcoflowHub

PLATFORMS: list[Platform] = [Platform.SENSOR]

type EcoflowConfigEntry = ConfigEntry[EcoflowHub]


async def async_setup_entry(hass: HomeAssistant, entry: EcoflowConfigEntry) -> bool:
    """Hub starten und Plattformen laden."""
    hub = EcoflowHub(hass, entry)
    await hub.async_start()
    entry.runtime_data = hub
    entry.async_on_unload(hub.async_stop)
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: EcoflowConfigEntry) -> bool:
    """Plattformen entladen."""
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
