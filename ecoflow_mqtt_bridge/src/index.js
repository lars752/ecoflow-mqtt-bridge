#!/usr/bin/env node
'use strict';
const { loadConfig } = require('./config');
const { logger, setLevel, addSecret } = require('./log');
const { createApp } = require('./app');
const { createWebUi } = require('./webui');
const { createPersister, saveOptions } = require('./credentials');
const { version } = require('../package.json');

async function main() {
  logger.info(`EcoFlow MQTT Bridge v${version} startet...`);
  const config = await loadConfig({ version });
  setLevel(config.logLevel);
  [config.accessKey, config.secretKey, config.emailPassword, config.mqtt.password, config.presetMqtt?.password].forEach(addSecret);

  logger.info(
    `Konfiguration: Anmeldung ${config.authMode === 'email' ? 'E-Mail (App-Login)' : `API-Key (${config.apiHost})`}, lokaler Broker ${config.mqtt.host}:${config.mqtt.port}, ` +
      `Discovery ${config.haDiscovery ? `an (${config.discoveryPrefix})` : 'aus'}, ${config.authMode === 'email' ? 'nur Live-MQTT' : `Abruf alle ${config.pollInterval}s`}`,
  );

  if (config.skippedDevices.length) {
    logger.warn(
      `${config.skippedDevices.length} Gerät(e) ohne gültige Seriennummer übersprungen: ${config.skippedDevices.map((d) => d.name || d.sn).join(', ')}. Seriennummern in der Add-on-Konfiguration ergänzen.`,
    );
  }

  const persist = createPersister({ config, logger });
  const onCredentials = async (creds) => {
    addSecret(creds.password);
    await persist(creds);
  };
  const app = createApp(config, logger, { onCredentials });

  // Weboberfläche (Ingress) vor dem Bridge-Start, damit "Anmeldedaten erstellen" auch bei Login-Problemen erreichbar ist
  const webui = createWebUi({
    config,
    api: app.api,
    cloud: app.cloud,
    bridge: app,
    logger,
    saveOptions: (patch) => saveOptions(patch),
    allowAny: process.env.WEBUI_ALLOW_ANY === '1',
  });
  try {
    const port = await webui.listen(Number(process.env.INGRESS_PORT) || 8099);
    logger.info(`Weboberfläche (Ingress) auf Port ${port}.`);
  } catch (err) {
    logger.warn(`Weboberfläche konnte nicht gestartet werden: ${err.message}`);
  }

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${signal} empfangen – fahre herunter...`);
    const force = setTimeout(() => process.exit(1), 8000);
    force.unref();
    try {
      await webui.close();
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
