/**
 * Liest die Konfiguration aus den Home Assistant Add-on Optionen (/data/options.json)
 * oder aus Umgebungsvariablen.
 */
const fs = require('fs');

function loadConfig() {
    let options = {};
    try {
        const optionsPath = '/data/options.json';
        if (fs.existsSync(optionsPath)) {
            options = JSON.parse(fs.readFileSync(optionsPath, 'utf8'));
        }
    } catch (e) {
        console.error('[Config] Konnte /data/options.json nicht lesen, verwende Env/Defaults:', e.message);
    }

    return {
        user: options.ecoflow_email || process.env.ECOFLOW_EMAIL || '',
        password: options.ecoflow_password || process.env.ECOFLOW_PASSWORD || '',
        mqttHost: options.mqtt_host || process.env.MQTT_HOST || 'core-mosquitto',
        mqttPort: options.mqtt_port || process.env.MQTT_PORT || 1883,
        mqttUser: options.mqtt_user || process.env.MQTT_USER || '',
        mqttPass: options.mqtt_password || process.env.MQTT_PASS || '',
        haEnable: options.haenable !== undefined ? options.haenable : true,
        haDebug: options.hadebug !== undefined ? options.hadebug : false
    };
}

module.exports = { loadConfig };
