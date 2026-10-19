"""Hub: hält Geräte und Zustände, die das Add-on „EcoFlow MQTT Bridge“ per MQTT veröffentlicht.

Topics (Basis-Topic standardmäßig ``ecoflow_bridge``):
  <base>/status               online/offline der Bridge
  <base>/accounts             Liste der EcoFlow-Konten [{id, name}] (nur für die Einrichtung), retained
  <base>/<sn>/meta            Gerätebeschreibung (Name, Typ, Datenpunkte), retained
  <base>/<sn>/state           aktuelle Werte als flaches JSON (bereits skaliert), retained
  <base>/<sn>/availability    online/offline des Geräts
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
import json
import logging
from typing import Any

from homeassistant.components import mqtt
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers.dispatcher import async_dispatcher_connect, async_dispatcher_send

from .const import CONF_ACCOUNT_ID, CONF_BASE_TOPIC, DOMAIN, MANUFACTURER

_LOGGER = logging.getLogger(__name__)


@dataclass
class EcoflowDevice:
    """Ein EcoFlow-Gerät, wie es das Add-on beschreibt."""

    sn: str
    name: str
    model: str | None = None
    entities: dict[str, dict[str, Any]] = field(default_factory=dict)  # Datenpunkt -> Beschreibung
    state: dict[str, Any] = field(default_factory=dict)
    available: bool = False


class EcoflowHub:
    """Verbindet MQTT-Nachrichten des Add-ons mit Geräten und Entities."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        self.hass = hass
        self.entry = entry
        self.base_topic: str = entry.data[CONF_BASE_TOPIC]
        # Konto dieses Hubs; ohne Angabe (ältere Einträge) gehören alle Geräte dazu
        self.account_id: str | None = entry.data.get(CONF_ACCOUNT_ID)
        self.devices: dict[str, EcoflowDevice] = {}
        # Zustände/Verfügbarkeit aller Geräte; nötig, weil sie vor der Gerätebeschreibung eintreffen können
        self._states: dict[str, dict[str, Any]] = {}
        self._available: dict[str, bool] = {}
        self.bridge_online = False
        self._unsubscribe: list[Callable[[], None]] = []

    @property
    def signal_new(self) -> str:
        """Signal: neue Datenpunkte (sn, [keys])."""
        return f"{DOMAIN}_{self.entry.entry_id}_new"

    def signal_update(self, sn: str) -> str:
        """Signal: neue Werte oder Verfügbarkeit eines Geräts."""
        return f"{DOMAIN}_{self.entry.entry_id}_update_{sn}"

    @callback
    def async_listen_new(self, target: Callable[[str, list[str]], None]) -> Callable[[], None]:
        """Ruft ``target(sn, keys)`` für neue Datenpunkte auf."""
        return async_dispatcher_connect(self.hass, self.signal_new, target)

    async def async_start(self) -> None:
        """Abonniert die Topics des Add-ons."""
        base = self.base_topic
        for topic, handler in (
            (f"{base}/status", self._on_status),
            (f"{base}/+/meta", self._on_meta),
            (f"{base}/+/state", self._on_state),
            (f"{base}/+/availability", self._on_availability),
        ):
            self._unsubscribe.append(await mqtt.async_subscribe(self.hass, topic, handler, qos=1))

    @callback
    def async_stop(self) -> None:
        """Beendet alle Abonnements."""
        for unsub in self._unsubscribe:
            unsub()
        self._unsubscribe.clear()

    def _serial(self, topic: str) -> str | None:
        parts = topic.split("/")
        base_len = len(self.base_topic.split("/"))
        return parts[base_len] if len(parts) == base_len + 2 and parts[base_len] else None

    def _device(self, sn: str) -> EcoflowDevice:
        if sn not in self.devices:
            self.devices[sn] = EcoflowDevice(
                sn=sn,
                name=sn,
                state=self._states.get(sn, {}),
                available=self._available.get(sn, False),
            )
        return self.devices[sn]

    @callback
    def _notify(self, sn: str) -> None:
        async_dispatcher_send(self.hass, self.signal_update(sn))

    @callback
    def _on_status(self, msg: mqtt.ReceiveMessage) -> None:
        self.bridge_online = str(msg.payload).strip() == "online"
        for sn in self.devices:
            self._notify(sn)

    @callback
    def _on_availability(self, msg: mqtt.ReceiveMessage) -> None:
        sn = self._serial(msg.topic)
        if sn is None:
            return
        self._available[sn] = str(msg.payload).strip() == "online"
        if sn in self.devices:
            self.devices[sn].available = self._available[sn]
            self._notify(sn)

    @callback
    def _on_state(self, msg: mqtt.ReceiveMessage) -> None:
        sn = self._serial(msg.topic)
        if sn is None:
            return
        try:
            data = json.loads(msg.payload)
        except (TypeError, ValueError):
            _LOGGER.debug("Ungültiger Zustand von %s ignoriert", msg.topic)
            return
        if not isinstance(data, dict):
            return
        self._states[sn] = data
        if sn in self.devices:
            self.devices[sn].state = data
            self._notify(sn)

    @callback
    def _on_meta(self, msg: mqtt.ReceiveMessage) -> None:
        sn = self._serial(msg.topic)
        if sn is None:
            return
        try:
            data = json.loads(msg.payload)
        except (TypeError, ValueError):
            _LOGGER.debug("Ungültige Gerätebeschreibung von %s ignoriert", msg.topic)
            return
        if not isinstance(data, dict) or not isinstance(data.get("entities", {}), dict):
            return

        # Geräte anderer EcoFlow-Konten gehören zu einem anderen Hub
        if self.account_id is not None and data.get("account") != self.account_id:
            return

        device = self._device(sn)
        device.name = str(data.get("name") or sn)
        device.model = data.get("type") or None
        entities = {k: v for k, v in data.get("entities", {}).items() if isinstance(v, dict) and v.get("slug")}
        new_keys = [key for key in entities if key not in device.entities]
        device.entities.update(entities)

        # Gerät sofort in der Geräteübersicht anlegen (auch wenn alle Entities deaktiviert sind)
        dr.async_get(self.hass).async_get_or_create(
            config_entry_id=self.entry.entry_id,
            identifiers={(DOMAIN, sn)},
            name=device.name,
            manufacturer=MANUFACTURER,
            model=device.model,
            serial_number=sn,
        )
        if new_keys:
            async_dispatcher_send(self.hass, self.signal_new, sn, new_keys)
