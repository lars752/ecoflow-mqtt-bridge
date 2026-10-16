/**
 * @file adapter_mock.js
 * @brief Emuliert das ioBroker Adapter-Core Framework für den Standalone-Betrieb.
 * 
 * Liest die Konfiguration aus den Home Assistant Add-on Optionen (/data/options.json),
 * stellt die notwendigen Adapter-Schnittstellen bereit und leitet Logmeldungen sowie
 * MQTT-Discovery-Daten direkt an den Broker weiter.
 */

const fs = require('fs');

// Lade die vom Benutzer in der Home Assistant GUI eingetragenen Add-on-Optionen
let options = {};
try {
    const optionsPath = '/data/options.json';
    if (fs.existsSync(optionsPath)) {
        options = JSON.parse(fs.readFileSync(optionsPath, 'utf8'));
    }
} catch (e) {
    console.error('[ERROR] Konnte /data/options.json nicht lesen:', e);
}

class MockAdapter {
    constructor(adapterName) {
        this.name = adapterName;
        
        // Mappe GUI-Optionen auf die Struktur, die der ioBroker-Adapter erwartet
        this.config = {
            user: options.ecoflow_email || '',
            password: options.ecoflow_password || '',
            haenable: true,
            hamqttHost: options.mqtt_host || 'core-mosquitto',
            hamqttPort: options.mqtt_port || 1883,
            hamqttUser: options.mqtt_user || '',
            hamqttPass: options.mqtt_password || '',
            hadebug: (options.log_level === 'debug')
        };

        // Logger-Funktionen mit konfigurierbaren Log-Levels
        const currentLogLevel = options.log_level || 'info';
        const levels = { debug: 0, info: 1, warn: 2, error: 3 };
        const threshold = levels[currentLogLevel] !== undefined ? levels[currentLogLevel] : 1;

        this.log = {
            info: (msg) => { if (threshold <= levels.info) console.log(`[INFO] [${this.name}] ${msg}`); },
            warn: (msg) => { if (threshold <= levels.warn) console.warn(`[WARN] [${this.name}] ${msg}`); },
            error: (msg) => { if (threshold <= levels.error) console.error(`[ERROR] [${this.name}] ${msg}`); },
            debug: (msg) => { if (this.config.hadebug && threshold <= levels.debug) console.log(`[DEBUG] [${this.name}] ${msg}`); }
        };
        
        // Simuliere die asynchrone Initialisierung des ioBroker-Adapters
        setTimeout(() => {
            if (this.readyCallback) {
                this.log.info('Mock-Adapter erfolgreich initialisiert, starte Adapter-Logik...');
                this.readyCallback();
            }
        }, 1000);
    }

    /**
     * Event-Registrierung (z.B. für 'ready' oder 'unload')
     */
    on(event, callback) {
        if (event === 'ready') {
            this.readyCallback = callback;
        } else if (event === 'unload') {
            this.unloadCallback = callback;
        }
    }

    // Stub-Methoden für ioBroker-Objekt- und State-Operationen
    setObjectNotExists(id, obj, callback) { if (callback) callback(); }
    setState(id, state, ack, callback) { if (callback) callback(); }
    getState(id, callback) { if (callback) callback(null, { val: null }); }
    getForeignState(id, callback) { if (callback) callback(null, { val: null }); }
    setForeignState(id, state, ack) {}
    subscribeStates(pattern) {}
    subscribeForeignStates(pattern) {}
}

module.exports = {
    Adapter: MockAdapter
};
