# EcoFlow MQTT Bridge

Home-Assistant-Add-on-Repository. Das Add-on `ecoflow_mqtt_bridge` liest EcoFlow-Geräte aus der Cloud
(Anmeldung per E-Mail/Passwort wie im ioBroker-Adapter oder per Developer-API-Keys; JSON- und Protobuf-Geräte)
und stellt sie lokal per MQTT inkl. Home Assistant Auto-Discovery bereit.

Installation: In Home Assistant unter *Einstellungen → Add-ons → Add-on-Store → ⋮ → Repositories* die
Repository-URL hinzufügen, Add-on installieren, Zugangsdaten und Geräte (Seriennummer + Gerätetyp) eintragen, starten.

Dokumentation: [`ecoflow_mqtt_bridge/DOCS.md`](ecoflow_mqtt_bridge/DOCS.md) ·
Änderungen: [`ecoflow_mqtt_bridge/CHANGELOG.md`](ecoflow_mqtt_bridge/CHANGELOG.md)

Anmeldung: In der Seitenleiste „EcoFlow“ E-Mail und Passwort eingeben und „Anmeldedaten erstellen“ klicken (wie im ioBroker-Adapter).

## Integration „EcoFlow“ (Hub mit Geräten und Entitäten)

Zusätzlich zum Add-on gibt es die Home-Assistant-Integration `custom_components/ecoflow_bridge`. Sie arbeitet wie
Home Connect: unter *Einstellungen → Geräte & Dienste → EcoFlow* gibt es pro EcoFlow-Konto einen **Hub** (Name des Kontos)
mit den Geräten und ihren Entitäten. Die Anmeldung bei EcoFlow bleibt im Add-on; die Integration liest nur dessen MQTT-Daten.

Installation:

1. Ordner `custom_components/ecoflow_bridge` nach `/config/custom_components/` kopieren (oder dieses Repository in HACS als
   benutzerdefiniertes Repository hinzufügen) und Home Assistant neu starten.
2. Voraussetzung: MQTT-Integration eingerichtet, Add-on läuft (mindestens Version 3.3.0; Export/Import der Add-on-Konfiguration ab 3.4.0).
3. *Einstellungen → Geräte & Dienste → Integration hinzufügen → EcoFlow* (bzw. „Hub hinzufügen“): Basis-Topic (Standard
   `ecoflow_bridge`) eintragen, die Integration prüft, ob das Add-on antwortet, und bietet dann die EcoFlow-Konten des Add-ons
   zur Auswahl an. Für **jedes weitere Konto** „Hub hinzufügen“ erneut ausführen; jedes Konto ist ein eigener Hub mit seinen Geräten.
4. Im Add-on **`ha_discovery` auf `false`** stellen und das Add-on neu starten, sonst entstehen die Sensoren doppelt
   (einmal über MQTT-Discovery, einmal über die Integration). Alte MQTT-Entitäten vorher bzw. danach löschen.

**Sichern und Laden:** Die Add-on-Konfiguration exportierst/importierst du als JSON in der Add-on-Weboberfläche (Seitenleiste
„EcoFlow“). Die Hubs der Integration: *Einstellungen → Geräte & Dienste → EcoFlow → Konfigurieren* zeigt die Konfiguration aller
Hubs als JSON zum Kopieren; über *Integration hinzufügen → EcoFlow → Konfiguration aus JSON laden* werden sie daraus
wiederhergestellt (bereits vorhandene Hubs werden übersprungen). Die JSON enthält keine Passwörter.

Geräte, Namen, Einheiten und Geräteklassen kommen aus dem Retained-Topic `<base>/<sn>/meta`, das das Add-on immer
veröffentlicht. Datenpunkte, die im Add-on nicht als primär gelten (z. B. Diagnosewerte), sind wie bei der Discovery
standardmäßig deaktiviert und lassen sich in Home Assistant einzeln aktivieren (oder im Add-on mit `enable_all_entities`).
Ein Gerät mit `ha_enable: false` im Add-on bekommt keine Entitäten.

Entwicklung: `cd ecoflow_mqtt_bridge && npm ci && npm test`; Integration: `pip install -r requirements_test.txt && pytest`
