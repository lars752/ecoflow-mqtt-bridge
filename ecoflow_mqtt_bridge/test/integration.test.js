'use strict';
/**
 * End-to-End-Test ohne Netzwerk nach außen: zwei In-Process-MQTT-Broker (EcoFlow-Cloud und
 * lokal) plus ein HTTP-Stub der EcoFlow-API, der die Signatur der Anfragen prüft.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const http = require('node:http');
const mqtt = require('mqtt');
const Aedes = require('aedes');
const { normalize } = require('../src/config');
const { EcoFlowApi, buildSignature } = require('../src/api');
const { CloudMqtt } = require('../src/cloud');
const { LocalMqtt } = require('../src/local');
const { Bridge } = require('../src/bridge');

const ACCESS = 'test-access';
const SECRET = 'test-secret';
const silent = { debug() {}, info() {}, warn() {}, error() {} };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function startBroker() {
  const aedes = new Aedes();
  const server = net.createServer(aedes.handle);
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve({ aedes, server, port: server.address().port })),
  );
}
const stopBroker = (b) => new Promise((r) => b.aedes.close(() => b.server.close(r)));

function startApi(cloudPort, state) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const params = Object.fromEntries(url.searchParams);
    const h = req.headers;
    const expected = buildSignature({ params, accessKey: ACCESS, secretKey: SECRET, nonce: h.nonce, timestamp: h.timestamp });
    const send = (obj) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(obj));
    };
    state.calls.push(url.pathname);
    if (h.accesskey !== ACCESS || h.sign !== expected) return send({ code: '8521', message: 'signature is wrong' });
    if (url.pathname === '/iot-open/sign/device/list') {
      return send({ code: '0', message: 'Success', data: [{ sn: 'SN1', deviceName: 'Delta Pro', online: 1 }, { sn: 'SN2', deviceName: 'Other', online: 0 }] });
    }
    if (url.pathname === '/iot-open/sign/device/quota/all') {
      return send({ code: '0', message: 'Success', data: { 'pd.soc': 80, 'pd.wattsInSum': 1200, 'inv.cfgAcEnabled': 1 } });
    }
    if (url.pathname === '/iot-open/sign/certification') {
      return send({ code: '0', message: 'Success', data: { certificateAccount: 'open-acct', certificatePassword: 'pw', url: '127.0.0.1', port: String(cloudPort), protocol: 'mqtt' } });
    }
    res.statusCode = 404;
    send({});
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

test('Ende-zu-Ende: REST-Basiswerte, Live-Update, Discovery, Verfügbarkeit, Overrides', async (t) => {
  const cloud = await startBroker();
  const localBroker = await startBroker();
  const state = { calls: [] };
  const api = await startApi(cloud.port, state);

  // Beobachter am lokalen Broker
  const seen = new Map();
  const observer = mqtt.connect(`mqtt://127.0.0.1:${localBroker.port}`);
  await new Promise((r) => observer.on('connect', r));
  observer.subscribe(['homeassistant/#', 'ecoflow_bridge/#']);
  observer.on('message', (topic, payload) => seen.set(topic, payload.toString()));

  const config = normalize({
    access_key: ACCESS,
    secret_key: SECRET,
    mqtt_host: '127.0.0.1',
    mqtt_port: localBroker.port,
    devices: ['SN1'],
    overrides: [{ match: 'wattsInSum$', scale: 0.1 }],
  }, '2.0.0');

  const ecoApi = new EcoFlowApi({ accessKey: ACCESS, secretKey: SECRET, baseUrl: `http://127.0.0.1:${api.port}` });
  const cloudClient = new CloudMqtt({ api: ecoApi, logger: silent, retryMs: 100 });
  const local = new LocalMqtt({ mqttCfg: config.mqtt, baseTopic: config.baseTopic, discoveryPrefix: config.discoveryPrefix, logger: silent });
  const bridge = new Bridge({ config, api: ecoApi, cloud: cloudClient, local, logger: silent });

  t.after(async () => {
    await bridge.stop();
    observer.end(true);
    await stopBroker(cloud);
    await stopBroker(localBroker);
    await new Promise((r) => api.server.close(r));
  });

  await bridge.start();
  await wait(1500); // Debounce der State-Veröffentlichung

  // Nur das konfigurierte Gerät wird betrieben
  assert.equal(seen.get('ecoflow_bridge/status'), 'online');
  assert.equal(seen.get('ecoflow_bridge/SN1/availability'), 'online');
  assert.equal(seen.has('ecoflow_bridge/SN2/availability'), false);

  // REST-Basiswerte inkl. Skalierung (1200 * 0.1)
  let st = JSON.parse(seen.get('ecoflow_bridge/SN1/state'));
  assert.equal(st['pd.soc'], 80);
  assert.equal(st['pd.wattsInSum'], 120);

  // Discovery
  const soc = JSON.parse(seen.get('homeassistant/sensor/ecoflow_sn1/pd_soc/config'));
  assert.equal(soc.device_class, 'battery');
  assert.equal(soc.state_topic, 'ecoflow_bridge/SN1/state');
  assert.equal(soc.enabled_by_default, undefined);
  const cfgFlag = JSON.parse(seen.get('homeassistant/sensor/ecoflow_sn1/inv_cfgacenabled/config'));
  assert.equal(cfgFlag.enabled_by_default, false);

  // Live-Update über die Cloud (Cloud-Broker -> Bridge -> lokaler Broker)
  cloud.aedes.publish({ topic: '/open/open-acct/SN1/quota', payload: Buffer.from(JSON.stringify({ params: { 'pd.soc': 77 } })), qos: 0, retain: false, cmd: 'publish', dup: false });
  await wait(1500);
  st = JSON.parse(seen.get('ecoflow_bridge/SN1/state'));
  assert.equal(st['pd.soc'], 77);
  assert.equal(st['pd.wattsInSum'], 120, 'bestehende Werte bleiben erhalten');

  // Status offline -> Verfügbarkeit offline
  cloud.aedes.publish({ topic: '/open/open-acct/SN1/status', payload: Buffer.from('{"params":{"status":0}}'), qos: 0, retain: false, cmd: 'publish', dup: false });
  await wait(300);
  assert.equal(seen.get('ecoflow_bridge/SN1/availability'), 'offline');

  // Unbekanntes/kaputtes Payload bringt die Bridge nicht aus dem Tritt
  cloud.aedes.publish({ topic: '/open/open-acct/SN1/quota', payload: Buffer.from('müll'), qos: 0, retain: false, cmd: 'publish', dup: false });
  await wait(200);
  assert.ok(state.calls.includes('/iot-open/sign/certification'));
});

test('API: falsche Signatur liefert verständlichen Fehler', async (t) => {
  const state = { calls: [] };
  const api = await startApi(1, state);
  t.after(() => new Promise((r) => api.server.close(r)));
  const bad = new EcoFlowApi({ accessKey: ACCESS, secretKey: 'falsch', baseUrl: `http://127.0.0.1:${api.port}` });
  await assert.rejects(() => bad.listDevices(), /signature is wrong \(Code 8521\)/);
});

test('API: Netzwerkfehler wird als EcoFlowApiError gemeldet', async () => {
  const dead = new EcoFlowApi({ accessKey: 'a', secretKey: 'b', baseUrl: 'http://127.0.0.1:1', timeoutMs: 1000 });
  await assert.rejects(() => dead.listDevices(), /Netzwerkfehler/);
});
