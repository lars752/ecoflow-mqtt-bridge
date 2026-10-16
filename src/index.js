#!/usr/bin/env node
/**
 * Hauptstartpunkt der EcoFlow MQTT Bridge (Standalone Home Assistant Add-on)
 */
const { loadConfig } = require('./config');
const { logger, setDebug } = require('./log');
const { EcoFlowClient } = require('./ecoflow');
const { MQTTBridge } = require('./bridge');

async function main() {
    logger.info('Starte EcoFlow MQTT Bridge Add-on (Vollständige Abbildung)...');
    
    const config = loadConfig();
    setDebug(config.haDebug);

    logger.info(`Konfiguration geladen - Broker: ${config.mqttHost}:${config.mqttPort}, HA-Discovery: ${config.haEnable}`);

    const ecoflowClient = new EcoFlowClient(config);
    await ecoflowClient.login();

    const bridge = new MQTTBridge(config, ecoflowClient);
    bridge.start();
}

main().catch(err => {
    logger.error('Kritischer Fehler beim Starten:', err);
    process.exit(1);
});
