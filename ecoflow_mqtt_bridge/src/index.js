#!/usr/bin/env node
'use strict';
const { loadConfig } = require('./config');
const { logger, setLevel, addSecret } = require('./log');
const { createApp } = require('./app');
const { createWebUi } = require('./webui');
const { createPersister, saveOptions, readOptions, restartSelf } = require('./credentials');
const { version } = require('../package.json');

async function main() {
  logger.info(`EcoFlow MQTT Bridge v${version} startet...`);
  const config = await loadConfig({ version });
  setLevel(config.logLevel);
  for (const acc of config.accounts) {
    [acc.accessKey, acc.secretKey, acc.emailPassword, acc.presetMqtt?.password].forEach(addSecret);
  }
  addSecret(config.mqtt.password);

  const modeText = (acc) => (acc.authMode === 'email' ? 'E-Mail (App-Login)' : `API-Key (${acc.apiHost})`);
  logger.info(
    `Konfiguration: ${config.accounts.length} Konto/Konten (${config.accounts.map((a) => `${a.name}: ${modeText(a)}`).join('; ')}), ` +
      `lokaler Broker ${config.mqtt.host}:${config.mqtt.port}, Discovery ${config.haDiscovery ? `an (${config.discoveryPrefix})` : 'aus'}`,
  );

  for (const acc of config.accounts) {
    if (acc.skippedDevices.length) {
      logger.warn(
        `Konto "${acc.name}": ${acc.skippedDevices.length} Gerät(e) ohne gültige Seriennummer übersprungen: ${acc.skippedDevices.map((d) => d.name || d.sn).join(', ')}. Seriennummern in der Add-on-Konfiguration ergänzen.`,
      );
    }
    if (!acc.devices.length && acc.authMode === 'email') {
      logger.warn(`Konto "${acc.name}": Keine Geräte konfiguriert. Im E-Mail-Modus gibt es keine automatische Geräteliste, Seriennummern unter "Geräte" eintragen (Feld "account" = Kontoname).`);
    }
  }

  // Neu erzeugte MQTT-Zugangsdaten je Konto in den Optionen speichern
  const onCredentials = (account) => {
    const persist = createPersister({ account, logger });
    return async (creds) => {
      addSecret(creds.password);
      await persist(creds);
    };
  };
  const app = createApp(config, logger, { onCredentials });

  // Weboberfläche (Ingress) vor dem Bridge-Start, damit "Anmeldedaten erstellen" auch bei Login-Problemen erreichbar ist
  const webui = createWebUi({
    config,
    app,
    logger,
    saveOptions: (patch) => saveOptions(patch),
    readOptions: () => readOptions(),
    restart: () => restartSelf(),
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
