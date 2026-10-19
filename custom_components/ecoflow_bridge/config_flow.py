"""Konfiguration: Hub hinzufügen (ein Hub je EcoFlow-Konto des Add-ons)."""

from __future__ import annotations

import asyncio
import json
from typing import Any

import voluptuous as vol

from homeassistant.components import mqtt
from homeassistant.config_entries import SOURCE_IMPORT, ConfigEntry, ConfigFlow, ConfigFlowResult, OptionsFlow
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.selector import (
    TextSelector,
    TextSelectorConfig,
    SelectOptionDict,
    SelectSelector,
    SelectSelectorConfig,
    SelectSelectorMode,
)

from .const import (
    ACCOUNTS_GRACE,
    BRIDGE_CHECK_TIMEOUT,
    CONF_ACCOUNT,
    CONF_ACCOUNT_ID,
    CONF_BASE_TOPIC,
    DEFAULT_BASE_TOPIC,
    DOMAIN,
)
from .portability import build_export, hub_unique_id, parse_import


async def _probe(hass: HomeAssistant, base_topic: str) -> tuple[bool, list[dict[str, str]] | None]:
    """Prüft, ob das Add-on online ist, und liest die Kontenliste (beides retained).

    Rückgabe: (online, Konten). Konten ist None, wenn das Add-on keine Kontenliste veröffentlicht (ältere Version).
    """
    online = asyncio.Event()
    got_accounts = asyncio.Event()
    accounts: list[dict[str, str]] | None = None

    @callback
    def _status(msg: mqtt.ReceiveMessage) -> None:
        if str(msg.payload).strip() == "online":
            online.set()

    @callback
    def _accounts(msg: mqtt.ReceiveMessage) -> None:
        nonlocal accounts
        try:
            data = json.loads(msg.payload)
        except (TypeError, ValueError):
            return
        if isinstance(data, list):
            accounts = [
                {"id": str(a["id"]), "name": str(a.get("name") or a["id"])}
                for a in data
                if isinstance(a, dict) and a.get("id")
            ]
            got_accounts.set()

    unsubscribes = [
        await mqtt.async_subscribe(hass, f"{base_topic}/status", _status, qos=1),
        await mqtt.async_subscribe(hass, f"{base_topic}/accounts", _accounts, qos=1),
    ]
    try:
        try:
            async with asyncio.timeout(BRIDGE_CHECK_TIMEOUT):
                await online.wait()
        except TimeoutError:
            return False, None
        try:
            async with asyncio.timeout(ACCOUNTS_GRACE):
                await got_accounts.wait()
        except TimeoutError:
            pass
        return True, accounts
    finally:
        for unsubscribe in unsubscribes:
            unsubscribe()


class EcoflowConfigFlow(ConfigFlow, domain=DOMAIN):
    """Hub hinzufügen: Basis-Topic des Add-ons prüfen, dann das EcoFlow-Konto wählen."""

    VERSION = 1

    def __init__(self) -> None:
        self._base_topic = DEFAULT_BASE_TOPIC
        self._accounts: list[dict[str, str]] = []

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        """Optionen: Konfiguration exportieren."""
        return EcoflowOptionsFlow()

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Auswahl: neuen Hub einrichten oder Konfiguration aus JSON laden."""
        if not await mqtt.async_wait_for_mqtt_client(self.hass):
            return self.async_abort(reason="mqtt_unavailable")
        return self.async_show_menu(step_id="user", menu_options=["hub", "import_json"])

    async def async_step_import_json(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Hubs aus einer zuvor exportierten JSON-Konfiguration anlegen."""
        errors: dict[str, str] = {}
        if user_input is not None:
            try:
                hubs = parse_import(user_input["config"])
            except ValueError as err:
                errors["config"] = str(err)
            else:
                known = {entry.unique_id for entry in self._async_current_entries()}
                new = [hub for hub in hubs if hub_unique_id(hub) not in known]
                if not new:
                    errors["config"] = "nothing_to_import"
                else:
                    # Jeder Hub ist ein eigener Eintrag: weitere über eigene Import-Flows anlegen
                    for hub in new[1:]:
                        self.hass.async_create_task(
                            self.hass.config_entries.flow.async_init(
                                DOMAIN, context={"source": SOURCE_IMPORT}, data=hub
                            )
                        )
                    return await self.async_step_import(new[0])
        return self.async_show_form(
            step_id="import_json",
            data_schema=vol.Schema({vol.Required("config"): TextSelector(TextSelectorConfig(multiline=True))}),
            errors=errors,
        )

    async def async_step_import(self, import_data: dict[str, Any]) -> ConfigFlowResult:
        """Einen Hub aus gesicherten Daten anlegen (ohne das Add-on zu prüfen)."""
        await self.async_set_unique_id(hub_unique_id(import_data))
        self._abort_if_unique_id_configured()
        return self.async_create_entry(title=import_data[CONF_ACCOUNT], data=dict(import_data))

    async def async_step_hub(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Basis-Topic abfragen und das Add-on suchen."""
        errors: dict[str, str] = {}
        if user_input is not None:
            base_topic = user_input[CONF_BASE_TOPIC].strip().strip("/")
            if not base_topic or "+" in base_topic or "#" in base_topic:
                errors[CONF_BASE_TOPIC] = "invalid_topic"
            else:
                online, accounts = await _probe(self.hass, base_topic)
                if not online:
                    errors["base"] = "bridge_not_found"
                else:
                    self._base_topic = base_topic
                    if accounts is None:
                        # Ältere Add-on-Version ohne Kontenliste: ein Hub für alle Geräte
                        return await self.async_step_manual()
                    configured = {
                        entry.data.get(CONF_ACCOUNT_ID)
                        for entry in self._async_current_entries()
                        if entry.data.get(CONF_BASE_TOPIC) == base_topic
                    }
                    self._accounts = [a for a in accounts if a["id"] not in configured]
                    if not self._accounts:
                        return self.async_abort(reason="no_accounts_left")
                    return await self.async_step_account()

        default_topic = (user_input or {}).get(CONF_BASE_TOPIC, DEFAULT_BASE_TOPIC)
        return self.async_show_form(
            step_id="hub",
            data_schema=vol.Schema({vol.Required(CONF_BASE_TOPIC, default=default_topic): str}),
            errors=errors,
        )

    async def async_step_account(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """EcoFlow-Konto des Add-ons auswählen (jedes Konto wird ein eigener Hub)."""
        if user_input is not None:
            account_id = user_input[CONF_ACCOUNT_ID]
            name = next((a["name"] for a in self._accounts if a["id"] == account_id), account_id)
            await self.async_set_unique_id(f"{self._base_topic}:{account_id}")
            self._abort_if_unique_id_configured()
            return self.async_create_entry(
                title=name,
                data={CONF_BASE_TOPIC: self._base_topic, CONF_ACCOUNT_ID: account_id, CONF_ACCOUNT: name},
            )

        return self.async_show_form(
            step_id="account",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_ACCOUNT_ID, default=self._accounts[0]["id"]): SelectSelector(
                        SelectSelectorConfig(
                            options=[SelectOptionDict(value=a["id"], label=a["name"]) for a in self._accounts],
                            mode=SelectSelectorMode.DROPDOWN,
                        )
                    )
                }
            ),
        )

    async def async_step_manual(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Ohne Kontenliste: nur einen Anzeigenamen für den (einzigen) Hub abfragen."""
        if user_input is not None:
            await self.async_set_unique_id(self._base_topic)
            self._abort_if_unique_id_configured()
            name = user_input[CONF_ACCOUNT].strip() or self._base_topic
            return self.async_create_entry(
                title=name, data={CONF_BASE_TOPIC: self._base_topic, CONF_ACCOUNT: name}
            )
        return self.async_show_form(
            step_id="manual", data_schema=vol.Schema({vol.Required(CONF_ACCOUNT, default=""): str})
        )


class EcoflowOptionsFlow(OptionsFlow):
    """Konfiguration aller Hubs als JSON anzeigen (zum Kopieren und Sichern)."""

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Exporttext anzeigen; Absenden schließt den Dialog ohne Änderung."""
        if user_input is not None:
            return self.async_create_entry(data=dict(self.config_entry.options))
        export = build_export(self.hass.config_entries.async_entries(DOMAIN))
        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema(
                {vol.Required("config", default=export): TextSelector(TextSelectorConfig(multiline=True))}
            ),
        )
