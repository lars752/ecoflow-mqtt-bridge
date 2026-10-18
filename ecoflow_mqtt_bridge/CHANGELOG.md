# Changelog

## 3.1.0

* **Anmeldung wie im ioBroker-Adapter:** Neue Weboberfläche in der Seitenleiste („EcoFlow“, Home-Assistant-Ingress) mit
  E-Mail, Passwort und dem Button **Anmeldedaten erstellen**. Der Button meldet sich bei EcoFlow an, erzeugt die
  MQTT-Zugangsdaten (Benutzer-ID, Benutzername, Passwort, Client-ID), zeigt sie an, speichert sie in den Add-on-Optionen
  und baut die Verbindung sofort neu auf.
* Neue Optionen `ecoflow_mqtt_broker` (Vorgabe `mqtts://mqtt-e.ecoflow.com`) und `ecoflow_mqtt_port` (Vorgabe `8883`)
  sowie die automatisch befüllten `ecoflow_mqtt_user_id`, `ecoflow_mqtt_username`, `ecoflow_mqtt_password`,
  `ecoflow_mqtt_client_id`. Gespeicherte Zugangsdaten werden beim Start ohne neuen Login verwendet; werden sie abgelehnt,
  erzeugt das Add-on automatisch neue.
* Geräteliste mit **HA enable** (`ha_enable`) und **Debug enable** (`debug`) pro Gerät, wie in der ioBroker-Gerätekonfiguration.
* Standard-Geräteliste: 10 PowerStream-800W-Geräte aus der ioBroker-Instanz `ecoflow-mqtt.8` (PS Akku 1–3 links/rechts,
  PS PV 01/04/07/08 Garten). Die Seriennummern sind Platzhalter (`…_ERGAENZEN`) und müssen vervollständigt werden;
  Geräte mit Platzhalter werden beim Start übersprungen (Warnung im Log).
* Tests für Konfiguration, gespeicherte Zugangsdaten, Weboberfläche und Speichern über den Supervisor.

## 3.0.1

* Eingabemaske: Feldbeschriftungen und Hilfetexte für die dynamische Geräteliste (Seriennummer, Gerätetyp als Auswahlliste, Anzeigename).
* Dokumentation: Tabelle Typ-ID → Produktname → Nachrichtenformat.
* Test stellt sicher, dass die Typauswahl in `config.yaml` exakt dem Gerätekatalog entspricht.

## 3.0.0

**Breaking:** `devices` ist jetzt eine Liste von Objekten (`sn`, `type`, `name`) statt einer Liste von Seriennummern.

* Vollständige Protobuf-Unterstützung im E-Mail-Modus: PowerStream, Delta 3/Pro 3, River 3, Stream, PowerOcean,
  Plug, Smart Meter, Wave 3, Glacier 55 u. a. (41 Gerätetypen, JSON und Protobuf).
* Gerätekatalog mit Protobuf-Definitionen, Einheiten, Skalierung und Namen aus ioBroker.ecoflow-mqtt
  (MIT, siehe `NOTICE.md`); regenerierbar mit `scripts/extract-adapter-data.js`.
* Entities nutzen Einheit, Skalierung, Geräteklasse und Namen aus dem Katalog (z. B. PowerStream: 0,1 W).
* Gerätetyp auch im API-Key-Modus nutzbar (Zuordnung über den Feldnamen).
* Eigener Gerätename (`name`) pro Gerät.

## 2.1.0

* Neu: Anmeldung per **E-Mail und Passwort** (App-Login wie im ioBroker-Adapter) als Alternative zu den
  Developer-API-Keys, ohne Developer-Portal. Neue Optionen `auth_mode`, `ecoflow_email`, `ecoflow_password`.
  Im E-Mail-Modus sind die Seriennummern in `devices` Pflicht, es gibt nur Live-MQTT (kein REST-Abgleich),
  und Protobuf-Geräte werden nicht ausgewertet (Warnung im Log).
* `access_key`/`secret_key` sind jetzt optional (nur im API-Key-Modus nötig).
* Fix: Verfügbarkeit der Geräte wird direkt nach dem Start veröffentlicht, nicht erst bei der ersten Änderung.

## 2.0.0

Vollständiger Neubau. **Breaking:** Optionen wurden umbenannt/ersetzt, das Add-on muss neu konfiguriert werden.

* Echte Datenquelle: EcoFlow Developer API (signierte REST-Aufrufe + Cloud-MQTT) statt Simulationsdaten
  und Platzhalter-Geräten. Zugang per `access_key`/`secret_key` statt E-Mail/Passwort.
* Alle Geräte des Kontos werden automatisch erkannt (optional per `devices` einschränkbar).
* Discovery pro Datenpunkt mit Verfügbarkeit (Bridge + Gerät), Geräteklasse nur bei eindeutiger Einheit,
  diagnostische Sensoren standardmäßig deaktiviert; erneute Discovery bei HA-Neustart.
* `overrides` für Skalierung/Einheit/Geräteklasse einzelner Datenpunkte.
* MQTT-Zugangsdaten des Brokers werden nicht mehr in eine URL gebaut (Sonderzeichen wie `#`/`@` im Passwort
  funktionieren); automatische Broker-Erkennung über den Supervisor (`mqtt_host` leer).
* Last Will, Reconnect, Zugangsdaten-Erneuerung bei Auth-Fehlern, sauberer Shutdown (SIGTERM).
* Secrets werden aus Logs geschwärzt; strikte Validierung der Optionen mit klaren Fehlermeldungen.
* Entfernt: `adapter_mock.js`, `run.sh`, Stub-Test, leere Datei, `axios`, 32-Bit-Architekturen
  (von Home Assistant nicht mehr unterstützt), persönliche Standardwerte (IP/Benutzername).
* Echte Tests (Unit + Ende-zu-Ende mit In-Process-MQTT-Brokern), reproduzierbarer Build per `package-lock.json`.
