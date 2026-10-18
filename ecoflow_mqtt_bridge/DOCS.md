# EcoFlow MQTT Bridge

Holt Daten deiner EcoFlow-Geräte aus der EcoFlow-Cloud, veröffentlicht sie auf deinem lokalen
MQTT-Broker und legt die Sensoren per **MQTT Discovery** in Home Assistant an. Die Bridge ist
**nur lesend** (keine Steuerbefehle).

## Anmeldung: zwei Wege

| | **E-Mail-Modus** | **API-Key-Modus** |
|---|---|---|
| Zugang | E-Mail + Passwort des EcoFlow-App-Kontos (wie im ioBroker-Adapter `ioBroker.ecoflow-mqtt`), **kein Developer-Portal** | Access/Secret Key aus dem Developer Portal (<https://developer.ecoflow.com>) |
| Schnittstelle | inoffizielle App-API, kann sich ohne Ankündigung ändern | offizielle, dokumentierte API |
| Geräte | `devices` Pflicht (Seriennummer + **Gerätetyp**) | automatisch alle Geräte des Kontos (Typ optional) |
| Daten | nur Live-MQTT; Gerät gilt nach 3 Min. Stille als offline | Live-MQTT + REST-Abgleich (`poll_interval`) |
| Gerätetypen | alle aus der Liste unten, JSON **und Protobuf** | alle, die die Developer API unterstützt |

Mit `auth_mode: auto` (Standard) wird der API-Key-Modus genutzt, wenn Access- **und** Secret Key
eingetragen sind, sonst der E-Mail-Modus. Mit `api_key` bzw. `email` lässt sich das erzwingen.

## Anmeldung per E-Mail: „Anmeldedaten erstellen“

Die Anmeldung läuft wie im ioBroker-Adapter `ioBroker.ecoflow-mqtt`:

1. In der Add-on-Konfiguration `ecoflow_email` und `ecoflow_password` eintragen (oder später in der Weboberfläche).
2. Add-on starten. Die Verbindungseinstellungen sind schon voreingestellt (`ecoflow_mqtt_broker` = `mqtts://mqtt-e.ecoflow.com`,
   `ecoflow_mqtt_port` = `8883`).
3. In der Seitenleiste **EcoFlow** öffnen. Dort stehen E-Mail und Passwort sowie der Button **Anmeldedaten erstellen**.
   Ein Klick meldet sich bei EcoFlow an und erzeugt die MQTT-Authentifizierung (Benutzer-ID, Benutzername, Passwort, Client-ID).
   Die Werte werden angezeigt (das Passwort nur verdeckt), in den Add-on-Optionen (`ecoflow_mqtt_*`) gespeichert und die
   Verbindung wird sofort neu aufgebaut. Passwort und E-Mail lassen sich dort auch ändern.

Ohne Klick erzeugt das Add-on die Zugangsdaten beim ersten Start automatisch und speichert sie. Gespeicherte Zugangsdaten werden
bei späteren Starts ohne neuen Login verwendet; lehnt EcoFlow sie ab, werden automatisch neue erzeugt. Ist `ecoflow_mqtt_broker`
leer, wird die vom Server gelieferte Broker-Adresse verwendet (z. B. für US-Konten).

Die Weboberfläche ist nur über Home Assistant (Ingress) erreichbar und zeigt zusätzlich die Geräteliste mit Online-Status.

## Geräte eintragen

In der Add-on-Konfiguration ist `devices` eine **dynamische Liste**: pro Gerät ein Eintrag mit Seriennummer,
Gerätetyp (Auswahlliste) und optionalem Namen; Einträge lassen sich hinzufügen und entfernen. Im YAML-Modus sieht das so aus:

```yaml
devices:
  - sn: "HW51ZXXXXXXXXXX"
    type: pstream800        # Gerätetyp, siehe Liste
    name: "Balkon links"    # optional, Name in Home Assistant
    ha_enable: true         # optional (Vorgabe true): Home-Assistant-Entities anlegen
    debug: false            # optional (Vorgabe false): empfangene Werte ins Log schreiben
  - sn: "R331XXXXXXXXXXX"
    type: delta2
```

Standardmäßig ist die Liste leer. Ohne Geräte startet das Add-on trotzdem (mit Warnung), damit die Weboberfläche zum Erstellen der Anmeldedaten erreichbar ist. Einträge, deren Seriennummer den Platzhalter `…ERGAENZEN` enthält, werden übersprungen.

Der **Gerätetyp** entscheidet im E-Mail-Modus, wie die Nachrichten gelesen werden:

* **Protobuf-Geräte** (die App sendet Binärdaten): `type` ist **Pflicht**, sonst warnt die Bridge einmalig im Log.
  `alternator, delta3, delta3classic, delta3maxplus, delta3plus, deltapro3, deltaproultra, glacier55, gnerator4k, panel2, plug, powerocean, poweroceanfit, poweroceanplus, pstream, pstream600, pstream800, rapidpro320, river3, river3plus, smartmeter, stream_ac, stream_ac_pro, stream_inverter, stream_ultra, stream_ultra_x, wave3`
* **JSON-Geräte**: `type` ist optional, liefert aber Einheiten, Skalierung und Namen.
  `delta, delta2, delta2max, deltamax, deltamini, deltapro, generator, glacier, panel, powerkit, powerkitbp2000, powerkitbp5000, river2max, river2pro, rivermax, riverpro, shelly3em, wave2`

### Gerätetypen (Auswahl im Feld „Gerätetyp“)

In der Eingabemaske von Home Assistant erscheint der Typ als Auswahlliste mit den IDs der ersten Spalte
(Home Assistant erlaubt keine Klartext-Beschriftungen für Auswahlwerte). Die Produktnamen sind sinngemäß
aus den Typ-IDs des ioBroker-Adapters abgeleitet. Fehlt dein Gerät, wähle den ähnlichsten Typ und prüfe
mit `log_level: debug`, ob die Werte plausibel sind.

| ID | Produkt | Nachrichtenformat |
|---|---|---|
| `alternator` | Alternator Charger | Protobuf |
| `delta` | Delta (Original) | JSON |
| `delta2` | Delta 2 | JSON |
| `delta2max` | Delta 2 Max | JSON |
| `delta3` | Delta 3 | Protobuf |
| `delta3classic` | Delta 3 Classic | Protobuf |
| `delta3maxplus` | Delta 3 Max Plus | Protobuf |
| `delta3plus` | Delta 3 Plus | Protobuf |
| `deltamax` | Delta Max | JSON |
| `deltamini` | Delta mini | JSON |
| `deltapro` | Delta Pro | JSON |
| `deltapro3` | Delta Pro 3 | Protobuf |
| `deltaproultra` | Delta Pro Ultra | Protobuf |
| `generator` | Generator | JSON |
| `glacier` | Glacier | JSON |
| `glacier55` | Glacier (Protobuf-Variante) | Protobuf |
| `gnerator4k` | Generator 4k (ID so im Adapter geschrieben) | Protobuf |
| `panel` | Smart Home Panel | JSON |
| `panel2` | Smart Home Panel 2 | Protobuf |
| `plug` | Smart Plug | Protobuf |
| `powerkit` | Power Kit | JSON |
| `powerkitbp2000` | Power Kit mit BP2000 | JSON |
| `powerkitbp5000` | Power Kit mit BP5000 | JSON |
| `powerocean` | PowerOcean | Protobuf |
| `poweroceanfit` | PowerOcean Fit | Protobuf |
| `poweroceanplus` | PowerOcean Plus | Protobuf |
| `pstream` | PowerStream (allgemein) | Protobuf |
| `pstream600` | PowerStream 600 W | Protobuf |
| `pstream800` | PowerStream 800 W | Protobuf |
| `rapidpro320` | Rapid Pro 320 | Protobuf |
| `river2max` | River 2 Max | JSON |
| `river2pro` | River 2 Pro | JSON |
| `river3` | River 3 | Protobuf |
| `river3plus` | River 3 Plus | Protobuf |
| `rivermax` | River Max | JSON |
| `riverpro` | River Pro | JSON |
| `shelly3em` | Shelly 3EM | JSON |
| `smartmeter` | Smart Meter | Protobuf |
| `stream_ac` | Stream AC | Protobuf |
| `stream_ac_pro` | Stream AC Pro | Protobuf |
| `stream_inverter` | Stream Mikro-Wechselrichter | Protobuf |
| `stream_ultra` | Stream Ultra | Protobuf |
| `stream_ultra_x` | Stream Ultra X | Protobuf |
| `wave2` | Wave 2 | JSON |
| `wave3` | Wave 3 | Protobuf |

Das Wörterbuch (Protobuf-Definitionen, Einheiten, Skalierung, Namen) stammt aus dem ioBroker-Adapter
`ioBroker.ecoflow-mqtt` (MIT-Lizenz, siehe `NOTICE.md`). Im API-Key-Modus ist `type` ebenfalls nutzbar:
Dann werden Skalierung und Einheiten per Feldname zugeordnet (z. B. `invOutputWatts` → 0,1 W).

**Wichtig zu den Werten (Protobuf-Geräte):** Alle dekodierten Felder werden veröffentlicht, benannt als
`<nachricht>.<feld>` (z. B. `inverter_heartbeat.invOutputWatts`) und mit der Skalierung aus dem Wörterbuch
umgerechnet (aus 1234 wird 123,4 W). Berechnete Zusatzwerte und Sonderlogik des ioBroker-Adapters werden nicht
nachgebaut; Energie-Zeitreihen und Zeitplan-Konfigurationen werden bewusst übersprungen. Die Entity-IDs
unterscheiden sich von denen in ioBroker.

## Voraussetzungen

1. Entweder E-Mail + Passwort des EcoFlow-Kontos **oder** Access/Secret Key. Bei den Keys die Region
   passend zum Konto wählen (`api-e.ecoflow.com` Europa/Global, `api-a.ecoflow.com` USA).
2. Ein MQTT-Broker. Mit dem Mosquitto-Add-on von Home Assistant genügt es, `mqtt_host` leer zu lassen;
   Zugangsdaten holt sich das Add-on automatisch vom Supervisor.

## Konfiguration

| Option | Bedeutung |
|---|---|
| `auth_mode` | `auto` (Standard), `api_key` oder `email` |
| `ecoflow_email`, `ecoflow_password` | App-Konto (E-Mail-Modus) |
| `access_key`, `secret_key` | Developer-API-Zugang (API-Key-Modus) |
| `api_host` | Region der Developer API (nur API-Key-Modus) |
| `devices` | Liste mit `sn`, `type`, `name`. API-Key-Modus: leer = alle Geräte. E-Mail-Modus: Pflicht |
| `poll_interval` | REST-Abgleich in Sekunden (30–3600), nur API-Key-Modus |
| `mqtt_host/port/user/password` | Eigener Broker; `mqtt_host` leer = Supervisor-Dienst |
| `ha_discovery`, `discovery_prefix` | Auto-Discovery an/aus, Präfix (Standard `homeassistant`) |
| `enable_all_entities` | Aus (Standard): nur Ladestand und Leistungen aktiv, übrige Sensoren angelegt, aber deaktiviert |
| `overrides` | Skalierung/Einheit/Geräteklasse einzelner Datenpunkte, siehe unten |
| `log_level` | `debug` zur Fehlersuche (zeigt auch Roh-Nachrichten, Secrets werden geschwärzt) |

## Topics

* `ecoflow_bridge/status` – Bridge online/offline (Last Will)
* `ecoflow_bridge/<SN>/availability` – Gerät online/offline
* `ecoflow_bridge/<SN>/state` – kompletter Gerätezustand als flaches JSON (retained)

## Einheiten und `overrides`

Mit angegebenem Gerätetyp kommen Einheit, Skalierung, Geräteklasse und Name aus dem Wörterbuch.
Ohne Typ werden nur eindeutige Einheiten automatisch gesetzt: `soc` (%), `*Watts` (W), `*temp*` (°C),
`*freq*` (Hz), `*remainTime*` (min); Spannung, Strom und Energie bleiben ohne Einheit. Feinjustierung
immer über `overrides` (überschreibt das Wörterbuch):

```yaml
overrides:
  - match: "bms_bmsStatus\\.vol$"   # regulärer Ausdruck, nicht verankert (^ und $ verwenden)
    scale: 0.001
    unit: "V"
    device_class: voltage
  - match: "^inverter_heartbeat\\.permanentWatts$"
    ignore: true
```

`ignore: true` unterdrückt die Entity. Mehrere passende Einträge werden der Reihe nach angewendet.
Eine ungültige `device_class` lehnt Home Assistant ab – nur Standard-Klassen verwenden.

## Fehlersuche

* **Add-on startet nicht / „Ungültige Konfiguration“**: Meldung im Log lesen; sie nennt die Option und die erlaubten Gerätetypen.
* **„signature is wrong“ / API-Fehler**: Access/Secret Key und Region prüfen.
* **Login schlägt fehl (E-Mail-Modus)**: Zugangsdaten prüfen. Konten, die nur über Google/Apple anmelden, haben ggf. kein Passwort.
* **Gerät bleibt offline (E-Mail-Modus)**: Seriennummer prüfen; Warnungen im Log lesen (fehlender oder falscher Gerätetyp).
* **Sensoren fehlen in HA**: Die meisten sind standardmäßig deaktiviert (`enable_all_entities` oder in HA einzeln aktivieren).
* **Werte unplausibel**: Gerätetyp prüfen, mit `log_level: debug` Rohdaten ansehen, notfalls per `overrides` skalieren.
