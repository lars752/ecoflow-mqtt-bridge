"""Tests: Geräte und Sensoren aus den MQTT-Nachrichten des Add-ons."""

import json

from homeassistant.config_entries import ConfigEntryState
from homeassistant.helpers import device_registry as dr, entity_registry as er
from pytest_homeassistant_custom_component.common import MockConfigEntry, async_fire_mqtt_message

from custom_components.ecoflow_bridge.const import CONF_ACCOUNT, CONF_ACCOUNT_ID, CONF_BASE_TOPIC, DOMAIN

SN = "HW51TEST00000001"
BASE = "ecoflow_bridge"

META = {
    "sn": SN,
    "name": "PS Test",
    "type": "pstream",
    "version": "3.2.0",
    "entities": {
        "inverter_heartbeat.invOutputWatts": {
            "slug": "inverter_heartbeat_invoutputwatts",
            "name": "Ausgangsleistung",
            "primary": True,
            "enabled": True,
            "unit": "W",
            "device_class": "power",
            "state_class": "measurement",
        },
        "inverter_heartbeat.someText": {"slug": "inverter_heartbeat_sometext", "name": "Text", "primary": False, "enabled": True},
        "inverter_heartbeat.volt": {
            "slug": "inverter_heartbeat_volt",
            "name": "Spannung",
            "primary": False,
            "enabled": True,
            "unit": "mAh",
            "device_class": "voltage",
            "state_class": "measurement",
        },
        "inverter_heartbeat.hidden": {
            "slug": "inverter_heartbeat_hidden",
            "name": "Versteckt",
            "primary": False,
            "enabled": False,
            "state_class": "measurement",
        },
    },
}


def _uid(slug: str) -> str:
    return f"ecoflow_{SN.lower()}_{slug}"


async def _setup(hass):
    entry = MockConfigEntry(
        domain=DOMAIN, title="lars@example.com", unique_id=BASE, data={CONF_ACCOUNT: "lars@example.com", CONF_BASE_TOPIC: BASE}
    )
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


def _fire(hass, suffix, payload):
    async_fire_mqtt_message(hass, f"{BASE}/{suffix}", payload if isinstance(payload, str) else json.dumps(payload))


def _entity(hass, slug):
    return er.async_get(hass).async_get_entity_id("sensor", DOMAIN, _uid(slug))


async def test_geraet_und_sensoren(hass, mqtt_mock):
    entry = await _setup(hass)
    _fire(hass, f"{SN}/meta", META)
    _fire(hass, f"{SN}/state", {
        "inverter_heartbeat.invOutputWatts": 1234.5,
        "inverter_heartbeat.someText": "läuft",
        "inverter_heartbeat.volt": 230000,
        "inverter_heartbeat.hidden": 7,
    })
    await hass.async_block_till_done()

    # Gerät erscheint unter dem Hub
    device = dr.async_get(hass).async_get_device(identifiers={(DOMAIN, SN)})
    assert device is not None
    assert device.name == "PS Test"
    assert device.manufacturer == "EcoFlow"
    assert device.model == "pstream"
    assert device.serial_number == SN
    assert entry.entry_id in device.config_entries

    # solange Bridge und Gerät nicht „online“ melden, sind die Sensoren nicht verfügbar
    power_id = _entity(hass, "inverter_heartbeat_invoutputwatts")
    assert power_id is not None
    assert hass.states.get(power_id).state == "unavailable"

    _fire(hass, "status", "online")
    _fire(hass, f"{SN}/availability", "online")
    await hass.async_block_till_done()

    power = hass.states.get(power_id)
    assert power.state == "1234.5"
    assert power.attributes["unit_of_measurement"] == "W"
    assert power.attributes["device_class"] == "power"
    assert power.attributes["state_class"] == "measurement"

    text = hass.states.get(_entity(hass, "inverter_heartbeat_sometext"))
    assert text.state == "läuft"

    # mAh passt nicht zur Geräteklasse „voltage“ -> Klasse wird verworfen, Einheit bleibt
    volt = hass.states.get(_entity(hass, "inverter_heartbeat_volt"))
    assert volt.state == "230000"
    assert volt.attributes["unit_of_measurement"] == "mAh"
    assert "device_class" not in volt.attributes

    # deaktivierte Datenpunkte stehen in der Registry, haben aber keinen Zustand
    hidden_id = _entity(hass, "inverter_heartbeat_hidden")
    assert hidden_id is not None
    assert er.async_get(hass).async_get(hidden_id).disabled_by is er.RegistryEntryDisabler.INTEGRATION
    assert hass.states.get(hidden_id) is None

    # Diagnose-Kategorie für nicht-primäre Datenpunkte
    assert er.async_get(hass).async_get(_entity(hass, "inverter_heartbeat_sometext")).entity_category.value == "diagnostic"
    assert er.async_get(hass).async_get(power_id).entity_category is None


async def test_verfuegbarkeit_und_updates(hass, mqtt_mock):
    await _setup(hass)
    _fire(hass, "status", "online")
    _fire(hass, f"{SN}/meta", META)
    _fire(hass, f"{SN}/availability", "online")
    _fire(hass, f"{SN}/state", {"inverter_heartbeat.invOutputWatts": 100})
    await hass.async_block_till_done()
    power_id = _entity(hass, "inverter_heartbeat_invoutputwatts")
    assert hass.states.get(power_id).state == "100"

    _fire(hass, f"{SN}/state", {"inverter_heartbeat.invOutputWatts": 250})
    await hass.async_block_till_done()
    assert hass.states.get(power_id).state == "250"

    _fire(hass, f"{SN}/availability", "offline")
    await hass.async_block_till_done()
    assert hass.states.get(power_id).state == "unavailable"

    _fire(hass, f"{SN}/availability", "online")
    _fire(hass, "status", "offline")
    await hass.async_block_till_done()
    assert hass.states.get(power_id).state == "unavailable"

    _fire(hass, "status", "online")
    await hass.async_block_till_done()
    assert hass.states.get(power_id).state == "250"


async def test_neue_datenpunkte_kommen_spaeter_dazu(hass, mqtt_mock):
    await _setup(hass)
    first = {**META, "entities": {k: v for k, v in META["entities"].items() if k.endswith("invOutputWatts")}}
    _fire(hass, f"{SN}/meta", first)
    await hass.async_block_till_done()
    assert _entity(hass, "inverter_heartbeat_invoutputwatts") is not None
    assert _entity(hass, "inverter_heartbeat_sometext") is None

    _fire(hass, f"{SN}/meta", META)
    await hass.async_block_till_done()
    assert _entity(hass, "inverter_heartbeat_sometext") is not None
    # kein Duplikat der ersten Entity
    entries = [e for e in er.async_get(hass).entities.values() if e.platform == DOMAIN]
    assert len(entries) == len(META["entities"])


async def test_nicht_numerischer_wert_in_numerischem_sensor_ist_unbekannt(hass, mqtt_mock):
    await _setup(hass)
    _fire(hass, "status", "online")
    _fire(hass, f"{SN}/meta", META)
    _fire(hass, f"{SN}/availability", "online")
    _fire(hass, f"{SN}/state", {"inverter_heartbeat.invOutputWatts": "kaputt"})
    await hass.async_block_till_done()
    assert hass.states.get(_entity(hass, "inverter_heartbeat_invoutputwatts")).state == "unknown"


async def test_ungueltige_nachrichten_werden_ignoriert(hass, mqtt_mock):
    await _setup(hass)
    _fire(hass, f"{SN}/meta", "kein json")
    _fire(hass, f"{SN}/state", "[1, 2]")
    _fire(hass, f"{SN}/meta", {"entities": {"x": "kein objekt"}})
    await hass.async_block_till_done()
    assert [e for e in er.async_get(hass).entities.values() if e.platform == DOMAIN] == []


async def test_entladen(hass, mqtt_mock):
    entry = await _setup(hass)
    assert entry.state is ConfigEntryState.LOADED
    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()
    assert entry.state is ConfigEntryState.NOT_LOADED


SN2 = "HW51TEST00000002"


def _meta_for(sn, name, account):
    return {
        "sn": sn,
        "account": account,
        "name": name,
        "type": "pstream",
        "entities": {
            "inverter_heartbeat.invOutputWatts": {
                "slug": "inverter_heartbeat_invoutputwatts",
                "name": "Ausgangsleistung",
                "primary": True,
                "enabled": True,
                "unit": "W",
                "device_class": "power",
                "state_class": "measurement",
            }
        },
    }


async def _hub(hass, account_id):
    entry = MockConfigEntry(
        domain=DOMAIN,
        title=account_id,
        unique_id=f"{BASE}:{account_id}",
        data={CONF_ACCOUNT: account_id, CONF_ACCOUNT_ID: account_id, CONF_BASE_TOPIC: BASE},
    )
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


async def test_ein_hub_je_konto_filtert_geraete(hass, mqtt_mock):
    haus = await _hub(hass, "haus")
    garten = await _hub(hass, "garten")

    # Zustand und Verfügbarkeit treffen vor der Gerätebeschreibung ein (Reihenfolge ist nicht garantiert)
    _fire(hass, "status", "online")
    _fire(hass, f"{SN}/state", {"inverter_heartbeat.invOutputWatts": 11})
    _fire(hass, f"{SN2}/state", {"inverter_heartbeat.invOutputWatts": 22})
    _fire(hass, f"{SN}/availability", "online")
    _fire(hass, f"{SN2}/availability", "online")
    _fire(hass, f"{SN}/meta", _meta_for(SN, "PS Haus", "haus"))
    _fire(hass, f"{SN2}/meta", _meta_for(SN2, "PS Garten", "garten"))
    await hass.async_block_till_done()

    devices = dr.async_get(hass)
    d1 = devices.async_get_device(identifiers={(DOMAIN, SN)})
    d2 = devices.async_get_device(identifiers={(DOMAIN, SN2)})
    assert d1.config_entries == {haus.entry_id}
    assert d2.config_entries == {garten.entry_id}

    ent = er.async_get(hass)
    e1 = ent.async_get_entity_id("sensor", DOMAIN, f"ecoflow_{SN.lower()}_inverter_heartbeat_invoutputwatts")
    e2 = ent.async_get_entity_id("sensor", DOMAIN, f"ecoflow_{SN2.lower()}_inverter_heartbeat_invoutputwatts")
    assert ent.async_get(e1).config_entry_id == haus.entry_id
    assert ent.async_get(e2).config_entry_id == garten.entry_id
    assert hass.states.get(e1).state == "11"
    assert hass.states.get(e2).state == "22"


async def test_hub_ohne_konto_nimmt_alle_geraete(hass, mqtt_mock):
    """Einträge aus der ersten Version (ohne account_id) zeigen weiterhin alle Geräte."""
    await _setup(hass)
    _fire(hass, f"{SN}/meta", _meta_for(SN, "PS A", "haus"))
    _fire(hass, f"{SN2}/meta", _meta_for(SN2, "PS B", "garten"))
    await hass.async_block_till_done()
    devices = dr.async_get(hass)
    assert devices.async_get_device(identifiers={(DOMAIN, SN)}) is not None
    assert devices.async_get_device(identifiers={(DOMAIN, SN2)}) is not None
