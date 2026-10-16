# EcoFlow MQTT Bridge - Home Assistant Add-on

## Über dieses Add-on
Dieses lokale Home-Assistant-Add-on ermöglicht die direkte Anbindung von EcoFlow-Geräten (Powerstations, Smart Plugs, Zusatzbatterien etc.) über die offizielle EcoFlow Cloud-API und integriert sie via Home Assistant MQTT Discovery vollautomatisch in dein Smart Home – **vollkommen ohne laufenden ioBroker-Server**.

Es basiert auf dem bewährten ioBroker-Adapter `ioBroker.ecoflow-mqtt`, welcher hier in einer isolierten Node.js-Umgebung ausgeführt und über einen eigens entwickelten Adapter-Core-Mock angebunden wird.

---

## Konfiguration (via Home Assistant GUI)

Das Add-on verfügt über eine vollständige grafische Benutzeroberfläche in Home Assistant (**Einstellungen -> Add-ons -> EcoFlow MQTT Bridge -> Konfiguration**). 

Folgende Parameter können direkt über die GUI angepasst werden:

* **`ecoflow_email`**: Deine Login-E-Mail-Adresse für das EcoFlow-Entwicklerkonto bzw. die EcoFlow-App.
* **`ecoflow_password`**: Dein EcoFlow-Passwort.
* **`mqtt_host`**: Hostname deines MQTT-Brokers (Standard: `core-mosquitto`, wenn das offizielle Mosquitto broker Add-on genutzt wird).
* **`mqtt_port`**: Port des MQTT-Brokers (Standard: `1883`).
* **`mqtt_user`**: Benutzername für den MQTT-Broker (optional, falls Authentifizierung aktiv).
* **`mqtt_password`**: Passwort für den MQTT-Broker (optional).
* **`log_level`**: Ausführlichkeit der Protokollierung (`info`, `debug`, `warn`, `error`).

---

## Funktionsweise & Hinweise

1. **MQTT Discovery:** Alle gefundenen Geräte und deren Datenpunkte (wie Akkustand, Eingangsleistung, Ausgangsleistung, Temperatur) werden automatisch im MQTT-Broker registriert und erscheinen unmittelbar unter **Einstellungen -> Geräte & Dienste -> MQTT** in deinem Home Assistant.
2. **Kein ioBroker nötig:** Der Adapter läuft autark in einem Alpine-Linux-Container mit Node.js 20.
3. **Fehlerbehebung:** Bei Verbindungsproblemen aktiviere in der Konfiguration den `log_level` auf `debug` und starte das Add-on neu, um detaillierte Einblicke in der Add-on-Protokollierung zu erhalten.
