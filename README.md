# EcoFlow MQTT Bridge

Home-Assistant-Add-on-Repository. Das Add-on `ecoflow_mqtt_bridge` liest EcoFlow-Geräte aus der Cloud
(Anmeldung per E-Mail/Passwort wie im ioBroker-Adapter oder per Developer-API-Keys; JSON- und Protobuf-Geräte)
und stellt sie lokal per MQTT inkl. Home Assistant Auto-Discovery bereit.

Installation: In Home Assistant unter *Einstellungen → Add-ons → Add-on-Store → ⋮ → Repositories* die
Repository-URL hinzufügen, Add-on installieren, Zugangsdaten und Geräte (Seriennummer + Gerätetyp) eintragen, starten.

Dokumentation: [`ecoflow_mqtt_bridge/DOCS.md`](ecoflow_mqtt_bridge/DOCS.md) ·
Änderungen: [`ecoflow_mqtt_bridge/CHANGELOG.md`](ecoflow_mqtt_bridge/CHANGELOG.md)

Anmeldung: In der Seitenleiste „EcoFlow“ E-Mail und Passwort eingeben und „Anmeldedaten erstellen“ klicken (wie im ioBroker-Adapter).

Entwicklung: `cd ecoflow_mqtt_bridge && npm ci && npm test`
