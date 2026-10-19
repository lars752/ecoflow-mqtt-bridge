"""Konfiguration der Hubs sichern und laden (JSON)."""

from __future__ import annotations

import json
from typing import Any

from homeassistant.config_entries import ConfigEntry

from .const import CONF_ACCOUNT, CONF_ACCOUNT_ID, CONF_BASE_TOPIC

FORMAT = "ecoflow-bridge-hubs"
FORMAT_VERSION = 1


def hub_unique_id(hub: dict[str, Any]) -> str:
    """Eindeutige ID eines Hubs: Basis-Topic (+ Konto)."""
    base = hub[CONF_BASE_TOPIC]
    return f"{base}:{hub[CONF_ACCOUNT_ID]}" if hub.get(CONF_ACCOUNT_ID) else base


def build_export(entries: list[ConfigEntry]) -> str:
    """Alle Hubs als JSON-Text (Basis-Topic, Konto-ID, Anzeigename)."""
    hubs = []
    for entry in sorted(entries, key=lambda e: e.title.lower()):
        hub: dict[str, Any] = {CONF_BASE_TOPIC: entry.data[CONF_BASE_TOPIC]}
        if entry.data.get(CONF_ACCOUNT_ID):
            hub[CONF_ACCOUNT_ID] = entry.data[CONF_ACCOUNT_ID]
        hub[CONF_ACCOUNT] = entry.data.get(CONF_ACCOUNT) or entry.title
        hubs.append(hub)
    return json.dumps({"format": FORMAT, "version": FORMAT_VERSION, "hubs": hubs}, ensure_ascii=False, indent=2)


def parse_import(text: str) -> list[dict[str, Any]]:
    """Liest einen Import (Exportdokument oder einzelner Hub) und liefert bereinigte Hubs.

    Wirft ValueError("invalid_json") bzw. ValueError("invalid_format").
    """
    try:
        data = json.loads(text)
    except (TypeError, ValueError) as err:
        raise ValueError("invalid_json") from err
    if not isinstance(data, dict):
        raise ValueError("invalid_format")
    if "format" in data and data["format"] != FORMAT:
        raise ValueError("invalid_format")
    if isinstance(data.get("version"), int) and data["version"] > FORMAT_VERSION:
        raise ValueError("invalid_format")
    raw_hubs = data["hubs"] if "hubs" in data else [data]
    if not isinstance(raw_hubs, list) or not raw_hubs:
        raise ValueError("invalid_format")

    hubs: list[dict[str, Any]] = []
    for raw in raw_hubs:
        if not isinstance(raw, dict) or not isinstance(raw.get(CONF_BASE_TOPIC), str):
            raise ValueError("invalid_format")
        base = raw[CONF_BASE_TOPIC].strip().strip("/")
        if not base or "+" in base or "#" in base:
            raise ValueError("invalid_format")
        hub: dict[str, Any] = {CONF_BASE_TOPIC: base}
        account_id = raw.get(CONF_ACCOUNT_ID)
        if account_id is not None:
            if not isinstance(account_id, str) or not account_id.strip():
                raise ValueError("invalid_format")
            hub[CONF_ACCOUNT_ID] = account_id.strip()
        name = raw.get(CONF_ACCOUNT)
        hub[CONF_ACCOUNT] = name.strip() if isinstance(name, str) and name.strip() else hub.get(CONF_ACCOUNT_ID, base)
        if all(hub_unique_id(hub) != hub_unique_id(other) for other in hubs):
            hubs.append(hub)
    return hubs
