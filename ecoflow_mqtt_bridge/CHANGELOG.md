# Changelog

## 3.4.0

* **Konfiguration sichern und laden (JSON):** In der Weboberfläche (Seitenleiste „EcoFlow“, Abschnitt „Konfiguration sichern
  und laden“) lässt sich die komplette Add-on-Konfiguration (Konten, Geräte, Broker, Optionen) als `ecoflow-config.json`
  exportieren und wieder importieren. Passwörter und Keys sind im Export standardmäßig leer (optional mit Haken
  aufnehmen); fehlen sie beim Import, werden sie aus der aktuellen Konfiguration übernommen (Konten über den Namen
  zugeordnet).
* Der Import prüft die Datei wie beim Start (Format, Kontozuordnung, Gerätetypen, doppelte Seriennummern), speichert sie
  über den Supervisor und startet das Add-on auf Wunsch neu. Bei Fehlern wird nichts verändert.

## 3.3.0

* **Mehrere EcoFlow-Konten:** Das bisherige Konto (E-Mail/Passwort bzw. API-Keys auf oberster Ebene) bleibt unverändert und
  kann mit `account_name` benannt werden. Weitere Konten kommen in die neue Liste `accounts` (Kontoname, E-Mail + Passwort oder
  API-Keys, automatisch erzeugte MQTT-Zugangsdaten). Jedes Konto hat eigene Anmeldung, eigene Cloud-MQTT-Verbindung und
  eigenen Status; alle teilen sich den lokalen Broker.
* Geräte bleiben in einer gemeinsamen Liste; das neue Feld `account` ordnet ein Gerät einem Konto zu (leer = erstes Konto).
  Seriennummern müssen über alle Konten eindeutig sein.
* Weboberfläche: pro Konto ein Abschnitt mit „Anmeldedaten erstellen“ und eigener Geräteliste. Erzeugte Zugangsdaten werden
  im jeweiligen Konto der Optionen gespeichert.
* Neues Retained-Topic `<base>/accounts` (Liste der Konten) und Feld `account` im Meta-Topic; die Integration legt
  damit pro Konto einen Hub an.

## 3.2.0

* Neues Retained-Topic `<base>/<sn>/meta` (Name, Gerätetyp, Datenpunkte mit Einheit, Geräteklasse, Primär-Flag) für die neue
  Home-Assistant-Integration „EcoFlow“ (`custom_components/ecoflow_bridge`). Wird immer veröffentlicht, auch bei
  `ha_discovery: false`; Geräte mit `ha_enable: false` bekommen keine Datenpunkte.

## 3.1.2

* Fix: `ecoflow_email` wird nicht mehr als E-Mail-Adresse validiert (Home Assistant lehnte das Speichern bei unvollständigen Eingaben mit „expected an email address“ ab). EcoFlow prüft die Anmeldung selbst.

## 3.1.1

* Die vorbelegte Liste mit 10 PowerStream-800W-Geräten wurde entfernt; `devices` ist standardmäßig leer.
* Im E-Mail-Modus startet das Add-on auch ohne Geräte (Warnung im Log), damit „Anmeldedaten erstellen“ erreichbar bleibt.

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
