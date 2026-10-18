#!/usr/bin/env node
'use strict';
const { loadConfig } = require('./config');
const { logger, setLevel, addSecret } = require('./log');
const { createApp } = require('./app');
const { version } = require('../package.json');

async function main() {
  logger.info(`EcoFlow MQTT Bridge v${version} startet...`);
  const config = await loadConfig({ version });
  setLevel(config.logLevel);
  [config.accessKey, config.secretKey, config.emailPassword, config.mqtt.password].forEach(addSecret);

  logger.info(
    `Konfiguration: Anmeldung ${config.authMode === 'email' ? 'E-Mail (App-Login)' : `API-Key (${config.apiHost})`}, lokaler Broker ${config.mqtt.host}:${config.mqtt.port}, ` +
      `Discovery ${config.haDiscovery ? `an (${config.discoveryPrefix})` : 'aus'}, ${config.authMode === 'email' ? 'nur Live-MQTT' : `Abruf alle ${config.pollInterval}s`}`,
  );

  const app = createApp(config, logger);

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${signal} empfangen – fahre herunter...`);
    const force = setTimeout(() => process.exit(1), 8000);
    force.unref();
    try {
      await app.stop();
    } catch (err) {
      logger.error(`Fehler beim Herunterfahren: ${err.message}`);
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (err) => logger.error('Unbehandelter Promise-Fehler:', err));

  await app.start();
  logger.info('Bridge läuft.');
}

main().catch((err) => {
  logger.error(`Start fehlgeschlagen: ${err.message}`);
  process.exit(1);
});
