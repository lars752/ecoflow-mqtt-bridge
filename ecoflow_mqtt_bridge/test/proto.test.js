'use strict';
/** Protobuf (App-Modus): echte Pakete mit den Definitionen aus dem Gerätekatalog bauen und dekodieren. */
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const http = require('node:http');
const mqtt = require('mqtt');
const Aedes = require('aedes');
const { getHeaderRoot, loadType, listTypes, resolveType } = require('../src/catalog');
const { decodeProto, decryptXor } = require('../src/proto');
const { normalize } = require('../src/config');
const { EcoFlowAppApi } = require('../src/app-api');
const { CloudMqtt } = require('../src/cloud');
const { LocalMqtt } = require('../src/local');
const { Bridge } = require('../src/bridge');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Baut ein App-Paket: HeaderMessage{Header{pdata=<Nachricht>, cmdFunc, cmdId, seq, encType}} */
function buildPacket(type, msgName, fields, { cmdFunc, cmdId, encType = 0, seq = 7, src = 53 }) {
  const entry = loadType(type);
  const T = entry.root.lookupType(msgName);
  let pdata = Buffer.from(T.encode(T.create(fields)).finish());
  if (encType === 1) pdata = decryptXor(pdata, seq); // XOR ist symmetrisch
  const HM = getHeaderRoot().lookupType('HeaderMessage');
  return Buffer.from(HM.encode(HM.create({ header: [{ pdata, cmdFunc, cmdId, seq, encType, src }] })).finish());
}

test('Katalog: alle 41 Gerätetypen laden, Aliasse lösen auf', () => {
  const types = listTypes().filter((t) => resolveType(t) === t);
  assert.equal(types.length, 41);
  for (const t of types) assert.ok(loadType(t), t);
  assert.equal(resolveType('pstream800'), 'pstream');
  assert.equal(resolveType('powerkitbp5000'), 'powerkit');
  assert.equal(resolveType('nope'), null);
});

test('decodeProto: PowerStream-Heartbeat (unverschlüsselt)', () => {
  const buf = buildPacket('pstream', 'inverter_heartbeat', { invOutputWatts: 1234, batSoc: 55, pv1InputVolt: 412 }, { cmdFunc: 20, cmdId: 1 });
  const r = decodeProto('pstream', buf);
  assert.deepEqual({ ...r.flat }, {
    'inverter_heartbeat.invOutputWatts': 1234,
    'inverter_heartbeat.batSoc': 55,
    'inverter_heartbeat.pv1InputVolt': 412,
  });
  assert.deepEqual(r.messages, ['inverter_heartbeat']);
});

test('decodeProto: verschlüsselte pdata (XOR mit seq) und src=32 bleibt unverschlüsselt', () => {
  const enc = buildPacket('pstream', 'inverter_heartbeat', { invOutputWatts: 99 }, { cmdFunc: 20, cmdId: 1, encType: 1, seq: 300 });
  assert.equal(decodeProto('pstream', enc).flat['inverter_heartbeat.invOutputWatts'], 99);
  // src 32: Adapter entschlüsselt nicht -> Paket wird unverändert gelesen
  const plain = buildPacket('pstream', 'inverter_heartbeat', { invOutputWatts: 5 }, { cmdFunc: 20, cmdId: 1, encType: 0, src: 32 });
  assert.equal(decodeProto('pstream', plain).flat['inverter_heartbeat.invOutputWatts'], 5);
});

test('decodeProto: unbekannte cmdId wird übersprungen, "code -2" = offline, Müll wirft', () => {
  const unknown = buildPacket('pstream', 'inverter_heartbeat', { invOutputWatts: 1 }, { cmdFunc: 20, cmdId: 9999 });
  const r = decodeProto('pstream', unknown);
  assert.equal(Object.keys(r.flat).length, 0);
  assert.match(r.skipped[0], /cmdId 9999/);

  const HM = getHeaderRoot().lookupType('HeaderMessage');
  const off = Buffer.from(HM.encode(HM.create({ header: [{ code: '-2' }] })).finish());
  assert.equal(decodeProto('pstream', off).offline, true);

  assert.throws(() => decodeProto('pstream', Buffer.from([0xff, 0xff, 0xff])));
  assert.throws(() => decodeProto('delta2', unknown), /Kein Protobuf-Gerätetyp/);
});

test('decodeProto: weitere Gerätefamilie (Stream) dekodiert generisch', () => {
  const e = loadType('stream_ac');
  const [func, v] = Object.entries(e.cmdFunc)[0];
  const [id, name] = Object.entries(v.cmdId).find(([, n]) => { try { e.root.lookupType(n); return true; } catch { return false; } });
  const buf = buildPacket('stream_ac', name, {}, { cmdFunc: Number(func), cmdId: Number(id) });
  assert.doesNotThrow(() => decodeProto('stream_ac', buf));
});

// ---- Ende-zu-Ende: PowerStream per App-Login, Protobuf über MQTT, skalierte Werte in HA
const startBroker = () => {
  const aedes = new Aedes();
  const server = net.createServer(aedes.handle);
  return new Promise((res) => server.listen(0, '127.0.0.1', () => res({ aedes, server, port: server.address().port })));
};
const stopBroker = (b) => new Promise((r) => b.aedes.close(() => b.server.close(r)));

test('Ende-zu-Ende: PowerStream (Protobuf) + Delta 2 (JSON) im E-Mail-Modus', async (t) => {
  const cloud = await startBroker();
  const localBroker = await startBroker();
  const api = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/auth/login') return res.end(JSON.stringify({ code: '0', data: { token: 'T', user: { userId: '1' } } }));
    res.end(JSON.stringify({ code: '0', data: { certificateAccount: 'app-a', certificatePassword: 'p', url: '127.0.0.1', port: String(cloud.port), protocol: 'mqtt' } }));
  });
  await new Promise((r) => api.listen(0, '127.0.0.1', r));
  const warns = [];
  const logger = { debug() {}, info() {}, warn: (m) => warns.push(m), error() {} };

  const seen = new Map();
  const observer = mqtt.connect(`mqtt://127.0.0.1:${localBroker.port}`);
  await new Promise((r) => observer.on('connect', r));
  observer.subscribe(['homeassistant/#', 'ecoflow_bridge/#']);
  observer.on('message', (topic, payload) => seen.set(topic, payload.toString()));

  const config = normalize({
    ecoflow_email: 'a@b.de', ecoflow_password: 'pw', mqtt_host: '127.0.0.1', mqtt_port: localBroker.port,
    devices: [{ sn: 'PS1', type: 'pstream800', name: 'Balkon' }, { sn: 'D2', type: 'delta2' }, { sn: 'NOTYPE' }],
  }, '3.0.0');
  const appApi = new EcoFlowAppApi({ email: 'a@b.de', password: 'pw', baseUrl: `http://127.0.0.1:${api.address().port}` });
  const types = new Map(config.devices.filter((d) => d.type).map((d) => [d.sn, d.type]));
  const bridge = new Bridge({
    config, api: appApi, logger, staleMs: 60000,
    cloud: new CloudMqtt({ api: appApi, logger, types, retryMs: 100 }),
    local: new LocalMqtt({ mqttCfg: config.mqtt, baseTopic: config.baseTopic, discoveryPrefix: config.discoveryPrefix, logger }),
  });
  t.after(async () => {
    await bridge.stop();
    observer.end(true);
    await stopBroker(cloud);
    await stopBroker(localBroker);
    await new Promise((r) => api.close(r));
  });
  await bridge.start();
  await wait(500); // Abonnement der Cloud-Topics abwarten

  const pub = (topic, payload) => cloud.aedes.publish({ topic, payload: Buffer.isBuffer(payload) ? payload : Buffer.from(payload), qos: 0, retain: false, cmd: 'publish', dup: false });
  pub('/app/device/property/PS1', buildPacket('pstream', 'inverter_heartbeat', { invOutputWatts: 1234, batSoc: 55, pv1InputVolt: 412 }, { cmdFunc: 20, cmdId: 1, encType: 1, seq: 9 }));
  pub('/app/device/property/D2', JSON.stringify({ params: { 'pd.soc': 80, 'bmsMaster.amp': 1500 } }));
  pub('/app/device/property/NOTYPE', Buffer.from([0x0a, 0x02, 0x08, 0x01]));
  await wait(1800);

  // PowerStream: Wert 1234 * 0.1 = 123.4 W, Spannung 41.2 V, Gerätename aus der Konfiguration
  const ps = JSON.parse(seen.get('ecoflow_bridge/PS1/state'));
  assert.equal(ps['inverter_heartbeat.invOutputWatts'], 123.4);
  assert.equal(ps['inverter_heartbeat.pv1InputVolt'], 41.2);
  assert.equal(ps['inverter_heartbeat.batSoc'], 55);
  const w = JSON.parse(seen.get('homeassistant/sensor/ecoflow_ps1/inverter_heartbeat_invoutputwatts/config'));
  assert.equal(w.unit_of_measurement, 'W');
  assert.equal(w.device_class, 'power');
  assert.equal(w.device.name, 'Balkon');
  assert.equal(w.enabled_by_default, undefined, 'Leistung ist standardmäßig aktiv');
  const v = JSON.parse(seen.get('homeassistant/sensor/ecoflow_ps1/inverter_heartbeat_pv1inputvolt/config'));
  assert.equal(v.device_class, 'voltage');
  assert.equal(v.enabled_by_default, false);

  // Delta 2 (JSON) bekommt Skalierung aus dem Katalog: 1500 mA * 0.001 = 1.5 A
  const d2 = JSON.parse(seen.get('ecoflow_bridge/D2/state'));
  assert.equal(d2['bmsMaster.amp'], 1.5);
  assert.equal(d2['pd.soc'], 80);

  // Gerät ohne Typ: einmalige verständliche Warnung
  assert.equal(warns.filter((m) => m.includes('NOTYPE') && m.includes('kein Gerätetyp')).length, 1);
  assert.equal(seen.has('ecoflow_bridge/NOTYPE/state'), false);
});
