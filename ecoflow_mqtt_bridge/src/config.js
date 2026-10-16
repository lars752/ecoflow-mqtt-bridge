/**
 * Konfigurationsmodul für das EcoFlow MQTT Bridge Add-on
 * Liest /data/options.json (Home Assistant) oder Umgebungsvariablen ein.
 */
const fs = require('fs');
const path = require('path');

const OPTIONS_PATH = '/data/options.json';

function loadConfig() {
    let raw = {};

    if (fs.existsSync(OPTIONS_PATH)) {
        try {
            const content = fs.readFileSync(OPTIONS_PATH, 'utf8');
            raw = JSON.parse(content);
        } catch (err) {
            console.error(`[ERROR] Fehler beim Lesen von ${OPTIONS_PATH}:`, err.message);
        }
    } else {
        const localPath = path.join(__dirname, 'options.json');
        if (fs.existsSync(localPath)) {
            try {
                raw = JSON.parse(fs.readFileSync(localPath, 'utf8'));
            } catch (err) {
                console.error(`[ERROR] Fehler beim Lesen der lokalen options.json:`, err.message);
            }
        }
    }

    // Host bereinigen, falls jemand "mqtt://" oder ":1883" ins Host-Feld eingetragen hat
    const rawHost = raw.mqttHost || raw.mqtt_broker || process.env.MQTT_HOST || 'core-mosquitto';
    const cleanHost = String(rawHost)
        .replace(/^mqtts?:\/\//, '')
        .replace(/:\d+$/, '');

    // Geräte-Liste normalisieren
    let devices = [];
    if (Array.isArray(raw.devices) && raw.devices.length > 0) {
        devices = raw.devices;
    } else if (raw.device_sn) {
        devices = String(raw.device_sn)
            .split(',')
            .map(s => s.trim())
            .filter(Boolean)
            .map(sn => ({
                sn: sn,
                name: `EcoFlow (${sn})`,
                type: 'DELTA_PRO'
            }));
    } else {
        devices = [
            {
                sn: 'HW21Z00000001',
                name: 'EcoFlow Delta Pro',
                type: 'DELTA_PRO'
            }
        ];
    }

    const email = raw.ecoflowEmail || raw.ecoflow_email || raw.ecoflowUser || process.env.ECOFLOW_EMAIL || '';
    const password = raw.ecoflowPassword || raw.ecoflow_password || raw.ecoflowPass || process.env.ECOFLOW_PASSWORD || '';
    const accessKey = raw.accessKey || raw.access_key || process.env.ECOFLOW_ACCESS_KEY || '';
    const secretKey = raw.secretKey || raw.secret_key || process.env.ECOFLOW_SECRET_KEY || '';

    return {
        // EcoFlow Cloud Login (App-Zugangsdaten + optionale Developer Keys)
        ecoflowEmail: email,
        ecoflowPassword: password,
        ecoflowUser: email,
        ecoflowPass: password,
        email: email,
        password: password,
        accessKey: accessKey,
        secretKey: secretKey,

        // Geräte-Konfiguration
        devices: devices,

        // MQTT Broker Konfiguration
        mqttHost: cleanHost,
        mqttPort: Number(raw.mqttPort || raw.mqtt_port || process.env.MQTT_PORT || 1883),
        mqttUser: raw.mqttUser || raw.mqtt_user || process.env.MQTT_USER || '',
        mqttPassword: raw.mqttPassword || raw.mqtt_password || process.env.MQTT_PASSWORD || '',

        // Home Assistant Discovery & Debug
        haEnable: raw.haEnable !== undefined ? Boolean(raw.haEnable) : (raw.ha_discovery !== undefined ? Boolean(raw.ha_discovery) : true),
        haDebug: raw.haDebug !== undefined ? Boolean(raw.haDebug) : false,
        haPrefix: raw.haPrefix || 'homeassistant',
        mqttPrefix: raw.mqttPrefix || 'ecoflow'
    };
}

module.exports = { loadConfig };
