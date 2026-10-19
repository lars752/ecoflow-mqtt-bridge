'use strict';
const { EcoFlowApi } = require('./api');
const { EcoFlowAppApi } = require('./app-api');
const { CloudMqtt } = require('./cloud');
const { LocalMqtt } = require('./local');
const { Bridge } = require('./bridge');

/**
 * Mehrere EcoFlow-Konten: jedes Konto hat eigene API-Anmeldung, Cloud-MQTT-Verbindung und Bridge;
 * alle teilen sich die Verbindung zum lokalen Broker und das Basis-Topic.
 * Zusätzlich: <base>/accounts (retained) listet die Konten für die Home-Assistant-Integration.
 */
class App {
  constructor({ config, local, accounts, logger }) {
    this.config = config;
    this.local = local;
    this.accounts = accounts; // [{ id, name, config, api, cloud, bridge }]
    this.log = logger;
    this.local.on('connect', () => this.publishAccounts());
  }

  /** Alle Geräte aller Konten (Seriennummer eindeutig). */
  get devices() {
    return new Map(this.accounts.flatMap((a) => [...a.bridge.devices]));
  }

  /** Kompatibilität: Zugriff auf das erste Konto. */
  get api() {
    return this.accounts[0].api;
  }

  get cloud() {
    return this.accounts[0].cloud;
  }

  publishAccounts() {
    const list = this.accounts.map((a) => ({ id: a.id, name: a.name }));
    this.local.publish(`${this.config.baseTopic}/accounts`, JSON.stringify(list), { retain: true, qos: 1 });
  }

  async start() {
    await Promise.all(
      this.accounts.map((a) =>
        a.bridge.start().catch((err) => {
          this.log.error(`Konto "${a.name}": Start fehlgeschlagen: ${err.message}`);
        }),
      ),
    );
    this.publishAccounts();
  }

  async stop() {
    await Promise.all(this.accounts.map((a) => a.bridge.stop()));
  }
}

function buildApi(account, config, overrides, onCredentials) {
  if (account.authMode === 'email') {
    return new EcoFlowAppApi({
      email: account.email,
      password: account.emailPassword,
      broker: config.ecoflowBroker,
      preset: account.presetMqtt,
      onCredentials: onCredentials?.(account),
    });
  }
  return new EcoFlowApi({ accessKey: account.accessKey, secretKey: account.secretKey, host: account.apiHost });
}

/**
 * Baut die App aus einer validierten Konfiguration zusammen.
 * `overrides` dient den Tests (api/cloud/local gelten für das erste Konto) und nimmt
 * `onCredentials(account)` entgegen: liefert pro Konto die Funktion, die neue MQTT-Zugangsdaten speichert.
 */
function createApp(config, logger, overrides = {}) {
  const local =
    overrides.local ??
    new LocalMqtt({ mqttCfg: config.mqtt, baseTopic: config.baseTopic, discoveryPrefix: config.discoveryPrefix, logger });

  const accounts = config.accounts.map((account, i) => {
    const api = (i === 0 && overrides.api) || buildApi(account, config, overrides, overrides.onCredentials);
    const types = new Map(account.devices.filter((d) => d.type).map((d) => [d.sn, d.type]));
    const accountLog = config.accounts.length > 1 ? prefixed(logger, account.name) : logger;
    const cloud = (i === 0 && overrides.cloud) || new CloudMqtt({ api, logger: accountLog, types });
    // Konfiguration dieses Kontos: globale Werte + Felder des Kontos
    const cfg = {
      ...config,
      authMode: account.authMode,
      accessKey: account.accessKey,
      secretKey: account.secretKey,
      email: account.email,
      emailPassword: account.emailPassword,
      apiHost: account.apiHost,
      devices: account.devices,
      skippedDevices: account.skippedDevices,
      presetMqtt: account.presetMqtt,
      accountId: account.id,
      accountName: account.name,
    };
    const bridge = new Bridge({ config: cfg, api, cloud, local, logger: accountLog, staleMs: overrides.staleMs });
    return { id: account.id, name: account.name, config: account, api, cloud, bridge };
  });
  return new App({ config, local, accounts, logger });
}

/** Logger, der bei mehreren Konten den Kontonamen voranstellt. */
function prefixed(logger, name) {
  const wrap = (level) => (msg, ...rest) => logger[level](typeof msg === 'string' ? `[${name}] ${msg}` : msg, ...rest);
  return { debug: wrap('debug'), info: wrap('info'), warn: wrap('warn'), error: wrap('error') };
}

module.exports = { createApp, App };
