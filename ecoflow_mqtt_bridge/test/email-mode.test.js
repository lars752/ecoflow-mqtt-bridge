'use strict';
/** E-Mail-Modus (App-Login): Stub der App-API + In-Process-MQTT-Broker. */
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const http = require('node:http');
const mqtt = require('mqtt');
const Aedes = require('aedes');
const { normalize } = require('../src/config');
const { EcoFlowAppApi } = require('../src/app-api');
const { CloudMqtt } = require('../src/cloud');
const { LocalMqtt } = require('../src/local');
const { Bridge } = require('../src/bridge');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const startBroker = () => {
  const aedes = new Aedes();
  const server = net.createServer(aedes.handle);
  return new Promise((res) => server.listen(0, '127.0.0.1', () => res({ aedes, server, port: server.address().port })));
};
const stopBroker = (b) => new Promise((r) => b.aedes.close(() => b.server.close(r)));

function startAppApi(cloudPort, seen, { badLogin = false } = {}) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      const send = (o) => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(o));
      };
      if (req.url === '/auth/login') {
        if (badLogin) return send({ code: '2026', message: 'password error' });
        return send({ code: '0', message: 'Success', data: { token: 'TOK', user: { userId: '4711' } } });
      }
      if (req.url.startsWith('/iot-auth/app/certification')) {
        if (req.headers.authorization !== 'Bearer TOK') return send({ code: '401', message: 'unauthorized' });
        return send({ code: '0', message: 'Success', data: { certificateAccount: 'app-acct', certificatePassword: 'pw', url: '127.0.0.1', port: String(cloudPort), protocol: 'mqtt' } });
      }
      res.statusCode = 404;
      send({});
    });
  });
  return new Promise((res) => server.listen(0, '127.0.0.1', () => res({ server, port: server.address().port })));
}

test('AppApi: Login mit Base64-Passwort, Bearer-Token, MQTT-Zugangsdaten mit App-ClientId', async (t) => {
  const seen = [];
  const api = await startAppApi(8883, seen);
  t.after(() => new Promise((r) => api.server.close(r)));
  const app = new EcoFlowAppApi({ email: 'a@b.de', password: 'p@ss#wort', baseUrl: `http://127.0.0.1:${api.port}` });
  const c = await app.getMqttCredentials();
  const login = JSON.parse(seen[0].body);
  assert.equal(login.email, 'a@b.de');
  assert.equal(Buffer.from(login.password, 'base64').toString(), 'p@ss#wort');
  assert.equal(login.scene, 'IOT_APP');
  assert.equal(seen[1].url, '/iot-auth/app/certification?userId=4711');
  assert.equal(c.account, 'app-acct');
  assert.match(c.clientId, /^ANDROID_[0-9a-f-]{36}_4711$/);
});

test('AppApi: falsches Passwort -> verständlicher Fehler', async (t) => {
  const api = await startAppApi(8883, [], { badLogin: true });
  t.after(() => new Promise((r) => api.server.close(r)));
  const app = new EcoFlowAppApi({ email: 'a@b.de', password: 'x', baseUrl: `http://127.0.0.1:${api.port}` });
  await assert.rejects(() => app.getMqttCredentials(), /password error \(Code 2026\)/);
});

test('E-Mail-Modus Ende-zu-Ende: Live-Daten, Discovery, Protobuf-Warnung, Offline nach Stille', async (t) => {
  const cloud = await startBroker();
  const localBroker = await startBroker();
  const api = await startAppApi(cloud.port, []);
  const warns = [];
  const logger = { debug() {}, info() {}, warn: (m) => warns.push(m), error() {} };

  const seen = new Map();
  const observer = mqtt.connect(`mqtt://127.0.0.1:${localBroker.port}`);
  await new Promise((r) => observer.on('connect', r));
  observer.subscribe(['homeassistant/#', 'ecoflow_bridge/#']);
  observer.on('message', (topic, payload) => seen.set(topic, payload.toString()));

  const config = normalize({
    ecoflow_email: 'a@b.de',
    ecoflow_password: 'pw',
    devices: ['SN1', 'PB1'],
    mqtt_host: '127.0.0.1',
    mqtt_port: localBroker.port,
  }, '2.1.0');
  const appApi = new EcoFlowAppApi({ email: 'a@b.de', password: 'pw', baseUrl: `http://127.0.0.1:${api.port}` });
  const bridge = new Bridge({
    config,
    api: appApi,
    cloud: new CloudMqtt({ api: appApi, logger, retryMs: 100 }),
    local: new LocalMqtt({ mqttCfg: config.mqtt, baseTopic: config.baseTopic, discoveryPrefix: config.discoveryPrefix, logger }),
    logger,
    staleMs: 1500,
  });
  t.after(async () => {
    await bridge.stop();
    observer.end(true);
    await stopBroker(cloud);
    await stopBroker(localBroker);
    await new Promise((r) => api.server.close(r));
  });

  await bridge.start();
  await wait(500);
  assert.equal(seen.get('ecoflow_bridge/SN1/availability'), 'offline', 'ohne Daten zunächst offline');

  const pub = (topic, payload) =>
    cloud.aedes.publish({ topic, payload: Buffer.isBuffer(payload) ? payload : Buffer.from(payload), qos: 0, retain: false, cmd: 'publish', dup: false });
  pub('/app/device/property/SN1', JSON.stringify({ params: { 'pd.soc': 66, 'pd.wattsInSum': 300 } }));
  await wait(1500);
  assert.equal(seen.get('ecoflow_bridge/SN1/availability'), 'online');
  const st = JSON.parse(seen.get('ecoflow_bridge/SN1/state'));
  assert.equal(st['pd.soc'], 66);
  assert.equal(JSON.parse(seen.get('homeassistant/sensor/ecoflow_sn1/pd_soc/config')).device_class, 'battery');

  // Protobuf-Gerät: einmalige Warnung, kein Absturz, kein Zustand
  pub('/app/device/property/PB1', Buffer.from([0x0a, 0x02, 0x08, 0x01, 0xff]));
  pub('/app/device/property/PB1', Buffer.from([0x0a, 0x02, 0x08, 0x01, 0xff]));
  await wait(300);
  assert.equal(warns.filter((w) => w.includes('PB1') && w.includes('Protobuf')).length, 1);
  assert.equal(seen.has('ecoflow_bridge/PB1/state'), false);

  // Stille -> offline (staleMs = 1500)
  await wait(2500);
  assert.equal(seen.get('ecoflow_bridge/SN1/availability'), 'offline');
  // neue Daten -> wieder online
  pub('/app/device/property/SN1', JSON.stringify({ params: { 'pd.soc': 65 } }));
  await wait(400);
  assert.equal(seen.get('ecoflow_bridge/SN1/availability'), 'online');
});
