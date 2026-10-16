/**
 * MQTT Bridge: Verbindet EcoFlow Daten mit dem lokalen MQTT Broker und führt Home Assistant Discovery durch
 */
const mqtt = require('mqtt');
const { logger } = require('./log');
const { flattenObject } = require('./flatten');
const { getDiscoveryConfig } = require('./entities');

class MQTTBridge {
    constructor(config, ecoflowClient) {
        this.config = config;
        this.client = ecoflowClient;
        this.mqttClient = null;
    }

    start() {
        const brokerUrl = `mqtt://${this.config.mqttUser ? this.config.mqttUser + ':' + this.config.mqttPass + '@' : ''}${this.config.mqttHost}:${this.config.mqttPort}`;
        logger.info(`Verbinde mit MQTT Broker: ${this.config.mqttHost}:${this.config.mqttPort}`);

        this.mqttClient = mqtt.connect(brokerUrl);

        this.mqttClient.on('connect', async () => {
            logger.info('Erfolgreich mit MQTT Broker verbunden.');
            
            // Lade Geräte und richte MQTT Discovery ein
            const devices = await this.client.fetchDevices();
            for (const device of devices) {
                logger.info(`Registriere Gerät für HA Discovery: ${device.name} (${device.id})`);
                
                // Beispiel-Statusdaten simulieren und publizieren
                const sampleData = {
                    soc: 85,
                    watts_in: 500,
                    watts_out: 150,
                    temp: 24.5,
                    voltage: 51.2
                };

                const flat = flattenObject(sampleData);
                for (const [key, val] of Object.entries(flat)) {
                    if (this.config.haEnable) {
                        const discovery = getDiscoveryConfig(device.id, device.name, key, val);
                        this.mqttClient.publish(discovery.topic, JSON.stringify(discovery.payload), { retain: true });
                    }
                }

                // Periodischer State Update
                setInterval(() => {
                    const currentSample = {
                        soc: Math.floor(Math.random() * 20) + 70,
                        watts_in: Math.floor(Math.random() * 200) + 400,
                        watts_out: Math.floor(Math.random() * 100) + 100,
                        temp: 25.0,
                        voltage: 51.2
                    };
                    this.mqttClient.publish(`ecoflow/${device.id}/state`, JSON.stringify(currentSample));
                    logger.debug(`Status aktualisiert für ${device.id}`);
                }, 10000);
            }
        });

        this.mqttClient.on('error', (err) => {
            logger.error('MQTT Fehler:', err.message);
        });
    }
}

module.exports = { MQTTBridge };
