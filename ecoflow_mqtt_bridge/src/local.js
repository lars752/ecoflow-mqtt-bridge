'use strict';
/**
 * Verbindung zum lokalen MQTT-Broker (z. B. Mosquitto). Meldet 'connect' und
 * 'ha-birth' (Home Assistant ist (neu) gestartet und braucht die Discovery erneut).
 * Last Will: <base>/status = offline (retained).
 */
const EventEmitter = require('node:events');
const mqtt = require('mqtt');

class LocalMqtt extends EventEmitter {
  constructor({ mqttCfg, baseTopic, discoveryPrefix, logger, mqttLib = mqtt }) {
    super();
    this.cfg = mqttCfg;
    this.base = baseTopic;
    this.prefix = discoveryPrefix;
    this.log = logger;
    this.mqtt = mqttLib;
    this.client = null;
  }

  connect() {
    const { host, port, username, password, tls } = this.cfg;
    this.log.info(`Verbinde mit lokalem MQTT-Broker ${host}:${port}`);
    this.client = this.mqtt.connect({
      protocol: tls ? 'mqtts' : 'mqtt',
      host,
      port,
      username: username || undefined,
      password: password || undefined,
      clientId: 'ecoflow_mqtt_bridge',
      reconnectPeriod: 5000,
      connectTimeout: 20000,
      queueQoSZero: false, // nichts aufstauen, nach Reconnect wird alles neu veröffentlicht
      will: { topic: `${this.base}/status`, payload: 'offline', retain: true, qos: 1 },
    });

    return new Promise((resolve) => {
      let first = true;
      this.client.on('connect', () => {
        this.log.info('Lokaler MQTT-Broker verbunden.');
        this.client.publish(`${this.base}/status`, 'online', { retain: true, qos: 1 });
        this.client.subscribe(`${this.prefix}/status`, { qos: 1 });
        this.emit('connect');
        if (first) {
          first = false;
          resolve();
        }
      });
      this.client.on('error', (err) => this.log.error(`Lokaler MQTT-Fehler: ${err.message}`));
      this.client.on('offline', () => this.log.warn('Lokaler MQTT-Broker offline.'));
      this.client.on('message', (topic, payload) => {
        if (topic === `${this.prefix}/status` && payload.toString() === 'online') this.emit('ha-birth');
      });
    });
  }

  publish(topic, payload, opts = {}) {
    if (!this.client || !this.client.connected) return;
    this.client.publish(topic, payload, opts, (err) => {
      if (err) this.log.warn(`Publish auf ${topic} fehlgeschlagen: ${err.message}`);
    });
  }

  async stop() {
    const c = this.client;
    if (!c) return;
    if (c.connected) {
      await new Promise((r) => c.publish(`${this.base}/status`, 'offline', { retain: true, qos: 1 }, () => r()));
    }
    await new Promise((r) => c.end(false, {}, r));
  }
}

module.exports = { LocalMqtt };
