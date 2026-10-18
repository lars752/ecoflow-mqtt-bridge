'use strict';
/**
 * Verbindung zum EcoFlow-Cloud-MQTT-Broker. Abonniert pro Gerät
 *   Developer API: /open/<account>/<sn>/quota und .../status
 *   App-Login:     /app/device/property/<sn>
 * und meldet 'quota' (sn, flat), 'status' (sn, online) sowie 'unsupported' (sn) für
 * Nicht-JSON-Nachrichten (Protobuf-Geräte im App-Modus).
 */
const EventEmitter = require('node:events');
const crypto = require('node:crypto');
const mqtt = require('mqtt');
const { parseQuota, parseStatus } = require('./payload');
const { loadType } = require('./catalog');
const { decodeProto } = require('./proto');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CloudMqtt extends EventEmitter {
  constructor({ api, logger, scheme = api?.mqttScheme ?? 'open', types = new Map(), mqttLib = mqtt, retryMs = 30000 }) {
    super();
    this.api = api;
    this.scheme = scheme; // 'open' = Developer API, 'app' = App-Login
    this.types = types; // sn -> aufgelöster Gerätetyp (für Protobuf-Dekodierung)
    this.unsupportedSeen = new Set();
    this.log = logger;
    this.mqtt = mqttLib;
    this.retryMs = retryMs;
    this.sns = [];
    this.client = null;
    this.account = null;
    this.stopped = false;
    this.refreshing = false;
    this.connecting = false;
  }

  async start(sns) {
    this.sns = sns;
    await this.connect();
  }

  async connect() {
    let creds;
    this.connecting = true;
    try {
      for (let attempt = 0; !this.stopped; attempt++) {
        try {
          creds = await this.api.getMqttCredentials();
          break;
        } catch (err) {
          this.log.error(`EcoFlow-MQTT-Zugangsdaten nicht abrufbar: ${err.message} – neuer Versuch in ${this.retryMs / 1000}s`);
          await sleep(this.retryMs);
        }
      }
    } finally {
      this.connecting = false;
    }
    if (this.stopped) return;

    this.account = creds.account;
    const url = `${creds.protocol}://${creds.url}:${creds.port}`;
    this.log.info(`Verbinde mit EcoFlow-Cloud-MQTT ${creds.url}:${creds.port}`);

    const client = this.mqtt.connect(url, {
      username: creds.account,
      password: creds.password,
      clientId: creds.clientId ?? `ha-ecoflow-bridge_${crypto.randomUUID()}`,
      keepalive: 60,
      reconnectPeriod: 5000,
      connectTimeout: 20000,
      clean: true,
    });
    this.client = client;

    client.on('connect', () => {
      this.refreshing = false;
      this.log.info('EcoFlow-Cloud-MQTT verbunden.');
      const topics = this.sns.flatMap((sn) => this.topicsFor(sn));
      if (!topics.length) return;
      client.subscribe(topics, { qos: 1 }, (err) => {
        if (err) this.log.error(`Abonnieren fehlgeschlagen: ${err.message}`);
        else this.log.debug(`Abonniert: ${topics.join(', ')}`);
      });
    });
    client.on('reconnect', () => this.log.warn('EcoFlow-Cloud-MQTT: Verbindung wird neu aufgebaut...'));
    client.on('offline', () => this.log.warn('EcoFlow-Cloud-MQTT offline.'));
    client.on('error', (err) => {
      this.log.error(`EcoFlow-Cloud-MQTT Fehler: ${err.message}`);
      // 4 = ungültige Zugangsdaten, 5 = nicht autorisiert -> neue Zugangsdaten holen
      if (err.code === 4 || err.code === 5 || /not authorized|bad user/i.test(err.message)) this.refreshCredentials();
    });
    client.on('message', (topic, payload) => this.onMessage(topic, payload));
  }

  topicsFor(sn) {
    if (this.scheme === 'app') return [`/app/device/property/${sn}`];
    return [`/open/${this.account}/${sn}/quota`, `/open/${this.account}/${sn}/status`];
  }

  async refreshCredentials() {
    if (this.refreshing || this.stopped) return;
    this.refreshing = true;
    this.log.warn('Zugangsdaten wurden abgelehnt – hole neue Zugangsdaten von der EcoFlow-API.');
    this.api.invalidate?.();
    const old = this.client;
    this.client = null;
    if (old) await new Promise((r) => old.end(true, {}, r));
    await sleep(this.retryMs);
    this.refreshing = false;
    if (!this.stopped) await this.connect();
  }

  /** Verbindung sofort mit den aktuellen Zugangsdaten neu aufbauen (z. B. nach "Anmeldedaten erstellen"). */
  async reconnectNow() {
    // Läuft gerade die Anmeldeschleife, nimmt sie beim nächsten Versuch die neuen Zugangsdaten
    if (this.stopped || this.connecting) return;
    const old = this.client;
    this.client = null;
    if (old) await new Promise((r) => old.end(true, {}, r));
    this.refreshing = false;
    await this.connect();
  }

  onMessage(topic, payload) {
    const parts = topic.split('/');
    let sn;
    let kind;
    if (this.scheme === 'app') {
      // ['', 'app', 'device', 'property', sn]
      if (parts.length !== 5 || parts[1] !== 'app' || parts[2] !== 'device' || parts[3] !== 'property') return;
      sn = parts[4];
      kind = 'quota';
    } else {
      // ['', 'open', account, sn, kind]
      if (parts.length !== 5 || parts[1] !== 'open') return;
      sn = parts[3];
      kind = parts[4];
    }
    this.log.debug(`MQTT ${topic}: ${payload.toString('utf8').slice(0, 500)}`);

    if (kind === 'quota') {
      if (!payload.toString('utf8').trimStart().startsWith('{')) {
        this.onProtobuf(sn, payload);
        return;
      }
      const flat = parseQuota(payload);
      if (flat) this.emit('quota', sn, flat);
      else this.log.debug(`Unbekanntes Quota-Format von ${sn}, ignoriert.`);
      if (this.scheme === 'app' && parseStatus(payload) === false) this.emit('status', sn, false);
    } else if (kind === 'status') {
      const online = parseStatus(payload);
      if (online !== null) this.emit('status', sn, online);
    }
  }

  /** Nicht-JSON-Nachricht: Protobuf je nach konfiguriertem Gerätetyp dekodieren. */
  onProtobuf(sn, payload) {
    const warnOnce = (reason, detail) => {
      if (this.unsupportedSeen.has(`${sn}:${reason}`)) return;
      this.unsupportedSeen.add(`${sn}:${reason}`);
      this.emit('unsupported', sn, reason, detail);
    };
    const type = this.types.get(sn);
    if (!type) return warnOnce('no-type');
    const entry = loadType(type);
    if (!entry || entry.kind !== 'proto') return warnOnce('wrong-type', type);
    let result;
    try {
      result = decodeProto(type, payload);
    } catch (err) {
      this.log.debug(`Protobuf von ${sn} (${type}) nicht dekodierbar: ${err.message}`);
      return warnOnce('decode-error', err.message);
    }
    if (result.skipped.length) this.log.debug(`${sn}: übersprungen: ${result.skipped.join('; ')}`);
    if (result.offline) this.emit('status', sn, false);
    if (Object.keys(result.flat).length) this.emit('quota', sn, result.flat);
  }

  async stop() {
    this.stopped = true;
    const c = this.client;
    this.client = null;
    if (c) await new Promise((r) => c.end(true, {}, r));
  }
}

module.exports = { CloudMqtt };
