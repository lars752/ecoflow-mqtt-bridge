"""Sensoren der EcoFlow-Geräte (dynamisch aus der Gerätebeschreibung des Add-ons)."""

from __future__ import annotations

import re
from typing import Any

from homeassistant.components.sensor import (
    DEVICE_CLASS_UNITS,
    SensorDeviceClass,
    SensorEntity,
    SensorStateClass,
)
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from . import EcoflowConfigEntry
from .const import DOMAIN, MANUFACTURER
from .hub import EcoflowHub


async def async_setup_entry(
    hass: HomeAssistant, entry: EcoflowConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    """Sensoren für bereits bekannte und später gemeldete Datenpunkte anlegen."""
    hub = entry.runtime_data
    added: set[tuple[str, str]] = set()

    @callback
    def _add(sn: str, keys: list[str]) -> None:
        device = hub.devices.get(sn)
        if device is None:
            return
        new = []
        for key in keys:
            if (sn, key) in added or key not in device.entities:
                continue
            added.add((sn, key))
            new.append(EcoflowSensor(hub, sn, key))
        if new:
            async_add_entities(new)

    for sn, device in list(hub.devices.items()):
        _add(sn, list(device.entities))
    entry.async_on_unload(hub.async_listen_new(_add))


def _device_class(meta: dict[str, Any]) -> SensorDeviceClass | None:
    """Geräteklasse nur übernehmen, wenn Home Assistant sie samt Einheit akzeptiert."""
    try:
        device_class = SensorDeviceClass(meta.get("device_class"))
    except ValueError:
        return None
    allowed = DEVICE_CLASS_UNITS.get(device_class)
    if allowed is not None and meta.get("unit") not in allowed:
        return None
    return device_class


class EcoflowSensor(SensorEntity):
    """Ein Datenpunkt eines EcoFlow-Geräts."""

    _attr_should_poll = False
    _attr_has_entity_name = True

    def __init__(self, hub: EcoflowHub, sn: str, key: str) -> None:
        self._hub = hub
        self._sn = sn
        self._key = key
        device = hub.devices[sn]
        meta = device.entities[key]

        self._attr_unique_id = f"ecoflow_{_slug(sn)}_{meta['slug']}"
        self._attr_name = meta.get("name") or key
        self._attr_native_unit_of_measurement = meta.get("unit") or None
        self._attr_device_class = _device_class(meta)
        try:
            self._attr_state_class = SensorStateClass(meta["state_class"]) if meta.get("state_class") else None
        except ValueError:
            self._attr_state_class = None
        primary = bool(meta.get("primary"))
        self._attr_entity_category = None if primary else EntityCategory.DIAGNOSTIC
        self._attr_entity_registry_enabled_default = bool(meta.get("enabled", primary))
        self._numeric = bool(
            self._attr_native_unit_of_measurement or self._attr_device_class or self._attr_state_class
        )
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, sn)},
            name=device.name,
            manufacturer=MANUFACTURER,
            model=device.model,
            serial_number=sn,
        )

    async def async_added_to_hass(self) -> None:
        """Auf Wertänderungen des Geräts hören."""
        self.async_on_remove(
            async_dispatcher_connect(self.hass, self._hub.signal_update(self._sn), self.async_write_ha_state)
        )

    @property
    def available(self) -> bool:
        """Verfügbar, wenn Bridge und Gerät online sind."""
        device = self._hub.devices.get(self._sn)
        return self._hub.bridge_online and device is not None and device.available

    @property
    def native_value(self) -> Any:
        """Aktueller Wert aus dem Gerätezustand."""
        device = self._hub.devices.get(self._sn)
        if device is None:
            return None
        value = device.state.get(self._key)
        if value is None:
            return None
        if self._numeric:
            # Sensoren mit Einheit/Klasse dürfen nur Zahlen melden
            return value if isinstance(value, (int, float)) and not isinstance(value, bool) else None
        return str(value)[:255]


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_") or "x"
