"""Tests des Config Flows (Hub hinzufügen, ein Hub je EcoFlow-Konto)."""

import asyncio
import json
from unittest.mock import patch

from homeassistant.data_entry_flow import FlowResultType
from pytest_homeassistant_custom_component.common import MockConfigEntry, async_fire_mqtt_message

from custom_components.ecoflow_bridge import config_flow
from custom_components.ecoflow_bridge.const import CONF_ACCOUNT, CONF_ACCOUNT_ID, CONF_BASE_TOPIC, DOMAIN

ACCOUNTS = [{"id": "haus", "name": "Haus"}, {"id": "garten", "name": "Garten"}]


async def _start(hass, step="hub"):
    """Flow starten und im Menü den gewünschten Weg wählen."""
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": "user"})
    assert result["type"] is FlowResultType.MENU
    assert result["menu_options"] == ["hub", "import_json"]
    return await hass.config_entries.flow.async_configure(result["flow_id"], {"next_step_id": step})


async def _to_account_step(hass, accounts=ACCOUNTS):
    result = await _start(hass)
    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "hub"
    with patch.object(config_flow, "_probe", return_value=(True, accounts)):
        return await hass.config_entries.flow.async_configure(result["flow_id"], {CONF_BASE_TOPIC: " /ecoflow_bridge/ "})


async def test_hub_fuer_konto_wird_angelegt(hass, mqtt_mock):
    result = await _to_account_step(hass)
    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "account"
    with patch("custom_components.ecoflow_bridge.async_setup_entry", return_value=True):
        result = await hass.config_entries.flow.async_configure(result["flow_id"], {CONF_ACCOUNT_ID: "garten"})
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["title"] == "Garten"
    assert result["data"] == {CONF_BASE_TOPIC: "ecoflow_bridge", CONF_ACCOUNT_ID: "garten", CONF_ACCOUNT: "Garten"}


async def test_zweites_konto_als_weiterer_hub(hass, mqtt_mock):
    MockConfigEntry(
        domain=DOMAIN,
        unique_id="ecoflow_bridge:haus",
        data={CONF_BASE_TOPIC: "ecoflow_bridge", CONF_ACCOUNT_ID: "haus", CONF_ACCOUNT: "Haus"},
    ).add_to_hass(hass)
    result = await _to_account_step(hass)
    # nur noch das nicht eingerichtete Konto steht zur Auswahl
    options = result["data_schema"].schema[CONF_ACCOUNT_ID].config["options"]
    assert [o["value"] for o in options] == ["garten"]
    with patch("custom_components.ecoflow_bridge.async_setup_entry", return_value=True):
        result = await hass.config_entries.flow.async_configure(result["flow_id"], {CONF_ACCOUNT_ID: "garten"})
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert len(hass.config_entries.async_entries(DOMAIN)) == 2


async def test_alle_konten_bereits_eingerichtet(hass, mqtt_mock):
    for acc in ACCOUNTS:
        MockConfigEntry(
            domain=DOMAIN,
            unique_id=f"ecoflow_bridge:{acc['id']}",
            data={CONF_BASE_TOPIC: "ecoflow_bridge", CONF_ACCOUNT_ID: acc["id"], CONF_ACCOUNT: acc["name"]},
        ).add_to_hass(hass)
    result = await _to_account_step(hass)
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "no_accounts_left"


async def test_aelteres_add_on_ohne_kontenliste(hass, mqtt_mock):
    result = await _to_account_step(hass, accounts=None)
    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "manual"
    with patch("custom_components.ecoflow_bridge.async_setup_entry", return_value=True):
        result = await hass.config_entries.flow.async_configure(result["flow_id"], {CONF_ACCOUNT: "Mein Hub"})
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["data"] == {CONF_BASE_TOPIC: "ecoflow_bridge", CONF_ACCOUNT: "Mein Hub"}
    assert result["result"].unique_id == "ecoflow_bridge"


async def test_add_on_nicht_gefunden(hass, mqtt_mock):
    result = await _start(hass)
    with patch.object(config_flow, "_probe", return_value=(False, None)):
        result = await hass.config_entries.flow.async_configure(result["flow_id"], {CONF_BASE_TOPIC: "ecoflow_bridge"})
    assert result["type"] is FlowResultType.FORM
    assert result["errors"] == {"base": "bridge_not_found"}


async def test_ungueltiges_topic(hass, mqtt_mock):
    result = await _start(hass)
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {CONF_BASE_TOPIC: "eco/#"})
    assert result["errors"] == {CONF_BASE_TOPIC: "invalid_topic"}


async def test_probe_liest_status_und_konten(hass, mqtt_mock):
    task = hass.async_create_task(config_flow._probe(hass, "ecoflow_bridge"))
    await asyncio.sleep(0.05)
    async_fire_mqtt_message(hass, "ecoflow_bridge/accounts", json.dumps(ACCOUNTS + [{"nope": 1}]))
    async_fire_mqtt_message(hass, "ecoflow_bridge/status", "online")
    online, accounts = await task
    assert online is True
    assert accounts == ACCOUNTS


async def test_probe_ohne_kontenliste(hass, mqtt_mock):
    with patch.object(config_flow, "ACCOUNTS_GRACE", 0.1):
        task = hass.async_create_task(config_flow._probe(hass, "ecoflow_bridge"))
        await asyncio.sleep(0.05)
        async_fire_mqtt_message(hass, "ecoflow_bridge/status", "online")
        assert await task == (True, None)


async def test_probe_timeout(hass, mqtt_mock):
    with patch.object(config_flow, "BRIDGE_CHECK_TIMEOUT", 0.1):
        assert await config_flow._probe(hass, "ecoflow_bridge") == (False, None)


EXPORT = {
    "format": "ecoflow-bridge-hubs",
    "version": 1,
    "hubs": [
        {"base_topic": "ecoflow_bridge", "account_id": "haus", "account": "Haus"},
        {"base_topic": "ecoflow_bridge", "account_id": "garten", "account": "Garten"},
    ],
}


async def _import(hass, payload):
    result = await _start(hass, "import_json")
    assert result["step_id"] == "import_json"
    text = payload if isinstance(payload, str) else json.dumps(payload)
    return await hass.config_entries.flow.async_configure(result["flow_id"], {"config": text})


async def test_import_legt_alle_hubs_an(hass, mqtt_mock):
    with patch("custom_components.ecoflow_bridge.async_setup_entry", return_value=True):
        result = await _import(hass, EXPORT)
        await hass.async_block_till_done()
    assert result["type"] is FlowResultType.CREATE_ENTRY
    entries = hass.config_entries.async_entries(DOMAIN)
    assert sorted(e.title for e in entries) == ["Garten", "Haus"]
    assert sorted(e.unique_id for e in entries) == ["ecoflow_bridge:garten", "ecoflow_bridge:haus"]
    assert {e.data[CONF_ACCOUNT_ID] for e in entries} == {"haus", "garten"}


async def test_import_ueberspringt_vorhandene_hubs(hass, mqtt_mock):
    MockConfigEntry(
        domain=DOMAIN,
        title="Haus",
        unique_id="ecoflow_bridge:haus",
        data={CONF_BASE_TOPIC: "ecoflow_bridge", CONF_ACCOUNT_ID: "haus", CONF_ACCOUNT: "Haus"},
    ).add_to_hass(hass)
    with patch("custom_components.ecoflow_bridge.async_setup_entry", return_value=True):
        result = await _import(hass, EXPORT)
        await hass.async_block_till_done()
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["title"] == "Garten"
    assert len(hass.config_entries.async_entries(DOMAIN)) == 2


async def test_import_nichts_neues(hass, mqtt_mock):
    for hub in EXPORT["hubs"]:
        MockConfigEntry(
            domain=DOMAIN, title=hub["account"], unique_id=f"ecoflow_bridge:{hub['account_id']}", data=hub
        ).add_to_hass(hass)
    result = await _import(hass, EXPORT)
    assert result["type"] is FlowResultType.FORM
    assert result["errors"] == {"config": "nothing_to_import"}


async def test_import_einzelner_hub_ohne_konto_und_fehlerfaelle(hass, mqtt_mock):
    with patch("custom_components.ecoflow_bridge.async_setup_entry", return_value=True):
        result = await _import(hass, {"base_topic": " /ecoflow_bridge/ "})
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["title"] == "ecoflow_bridge"
    assert result["data"] == {CONF_BASE_TOPIC: "ecoflow_bridge", CONF_ACCOUNT: "ecoflow_bridge"}
    assert result["result"].unique_id == "ecoflow_bridge"

    for bad, error in (
        ("{kaputt", "invalid_json"),
        ("[1, 2]", "invalid_format"),
        ({"format": "anderes", "hubs": []}, "invalid_format"),
        ({"format": "ecoflow-bridge-hubs", "version": 9, "hubs": [{"base_topic": "x"}]}, "invalid_format"),
        ({"hubs": []}, "invalid_format"),
        ({"hubs": [{"base_topic": "eco/#"}]}, "invalid_format"),
        ({"hubs": [{"base_topic": "x", "account_id": ""}]}, "invalid_format"),
    ):
        result = await _import(hass, bad)
        assert result["type"] is FlowResultType.FORM, bad
        assert result["errors"] == {"config": error}, bad
        hass.config_entries.flow.async_abort(result["flow_id"])


async def test_options_flow_exportiert_alle_hubs(hass, mqtt_mock):
    entries = []
    for hub in EXPORT["hubs"]:
        entry = MockConfigEntry(
            domain=DOMAIN, title=hub["account"], unique_id=f"ecoflow_bridge:{hub['account_id']}", data=hub
        )
        entry.add_to_hass(hass)
        entries.append(entry)
    with patch("custom_components.ecoflow_bridge.async_setup_entry", return_value=True):
        result = await hass.config_entries.options.async_init(entries[0].entry_id)
        assert result["type"] is FlowResultType.FORM
        assert result["step_id"] == "init"
        exported = result["data_schema"].schema["config"] and next(
            iter(k.default() for k in result["data_schema"].schema if k == "config")
        )
        doc = json.loads(exported)
        assert doc["format"] == "ecoflow-bridge-hubs"
        assert doc["version"] == 1
        assert doc["hubs"] == [
            {"base_topic": "ecoflow_bridge", "account_id": "garten", "account": "Garten"},
            {"base_topic": "ecoflow_bridge", "account_id": "haus", "account": "Haus"},
        ]
        result = await hass.config_entries.options.async_configure(result["flow_id"], {"config": exported})
        assert result["type"] is FlowResultType.CREATE_ENTRY

    # Der Export lässt sich wieder importieren (nach dem Löschen aller Hubs)
    for entry in entries:
        await hass.config_entries.async_remove(entry.entry_id)
    with patch("custom_components.ecoflow_bridge.async_setup_entry", return_value=True):
        result = await _import(hass, exported)
        await hass.async_block_till_done()
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert len(hass.config_entries.async_entries(DOMAIN)) == 2
