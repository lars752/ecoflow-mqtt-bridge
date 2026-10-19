'use strict';
/** Meta-Topic <base>/<sn>/meta für die Home-Assistant-Integration "EcoFlow". */
const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const { normalize } = require('../src/config');
const { Bridge } = require('../src/bridge');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function setup(extra = {}, devices) {
  const published = [];
  const local = Object.assign(new EventEmitter(), {
    publish: (topic, payload, opts) => published.push({ topic, payload, opts }),
    connect: async () => {},
    stop: async () => {},
  });
  const cloud = Object.assign(new EventEmitter(), { start: async () => {}, stop: async () => {} });
  const config = normalize({
    ecoflow_email: 'a@b.de',
    ecoflow_password: 'pw',
    ha_discovery: false,
    devices: devices ?? [{ sn: 'HW51TEST00000001', type: 'pstream800', name: 'PS Test' }],
    ...extra,
  });
  const logger = { debug() {}, info() {}, warn() {}, error() {} };
  const bridge = new Bridge({ config, api: { supportsRest: false }, cloud, local, logger });
  await bridge.start();
  return { bridge, cloud, published };
}

test('Meta: wird auch ohne MQTT-Discovery retained veröffentlicht und enthält Einheiten/Klassen', async () => {
  const { bridge, cloud, published } = await setup();
  cloud.emit('quota', 'HW51TEST00000001', { 'inverter_heartbeat.invOutputWatts': 12340, 'inverter_heartbeat.someText': 'x' });
  await wait(1200);
  assert.ok(!published.some((p) => p.topic.startsWith('homeassistant/')), 'keine Discovery');
  const meta = published.filter((p) => p.topic === 'ecoflow_bridge/HW51TEST00000001/meta');
  assert.equal(meta.length, 1);
  assert.equal(meta[0].opts.retain, true);
  const m = JSON.parse(meta[0].payload);
  assert.equal(m.name, 'PS Test');
  assert.equal(m.type, 'pstream');
  assert.equal(m.account, 'a_b_de');
  const w = m.entities['inverter_heartbeat.invOutputWatts'];
  assert.equal(w.unit, 'W');
  assert.equal(w.device_class, 'power');
  assert.equal(w.primary, true);
  assert.equal(w.enabled, true);
  assert.match(w.slug, /invoutputwatts/);
  const t = m.entities['inverter_heartbeat.someText'];
  assert.equal(t.unit, undefined);
  assert.equal(t.primary, false);
  assert.equal(t.enabled, false);
  // zweiter Wert ohne neuen Schlüssel: Meta wird nicht erneut gesendet
  cloud.emit('quota', 'HW51TEST00000001', { 'inverter_heartbeat.invOutputWatts': 5 });
  await wait(1200);
  assert.equal(published.filter((p) => p.topic.endsWith('/meta')).length, 1);
  // Neuer Schlüssel -> Meta aktualisiert
  cloud.emit('quota', 'HW51TEST00000001', { 'inverter_heartbeat.newKey': 1 });
  await wait(1200);
  assert.equal(published.filter((p) => p.topic.endsWith('/meta')).length, 2);
  await bridge.stop();
});

test('Meta: Gerät mit ha_enable=false hat keine Entities; enable_all_entities aktiviert alle', async () => {
  const off = await setup({}, [{ sn: 'HW51TEST00000002', type: 'pstream800', name: 'Aus', ha_enable: false }]);
  off.cloud.emit('quota', 'HW51TEST00000002', { 'inverter_heartbeat.invOutputWatts': 1 });
  await wait(1200);
  assert.ok(!off.published.some((p) => p.topic.endsWith('/meta')), 'ohne Entities keine Meta');
  await off.bridge.stop();

  const all = await setup({ enable_all_entities: true });
  all.cloud.emit('quota', 'HW51TEST00000001', { 'inverter_heartbeat.someText': 'x' });
  await wait(1200);
  const m = JSON.parse(all.published.find((p) => p.topic.endsWith('/meta')).payload);
  assert.equal(m.entities['inverter_heartbeat.someText'].enabled, true);
  await all.bridge.stop();
});
