'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { flatten } = require('../src/flatten');
const { parseQuota, parseStatus } = require('../src/payload');
const { describeEntity, scaleValue, buildDiscovery, prettyName, slug } = require('../src/entities');
const { buildSignature } = require('../src/api');
const { normalize } = require('../src/config');
const { addSecret, redact } = require('../src/log');

test('flatten: verschachtelt, Arrays, null und leere Strukturen', () => {
  const out = flatten({ a: { b: 1, c: [10, { d: 2 }] }, n: null, e: {}, f: [] , s: 'x' });
  assert.deepEqual({ ...out }, { 'a.b': 1, 'a.c.0': 10, 'a.c.1.d': 2, s: 'x' });
});

test('flatten: __proto__ als Schlüssel vergiftet nichts', () => {
  const out = flatten(JSON.parse('{"__proto__":{"x":1}}'));
  assert.equal({}.x, undefined);
  assert.equal(out['__proto__.x'], 1);
});

test('parseQuota: params / param / data / ungültig', () => {
  assert.deepEqual({ ...parseQuota(Buffer.from('{"params":{"pd.soc":50}}')) }, { 'pd.soc': 50 });
  assert.deepEqual({ ...parseQuota(Buffer.from('{"param":{"a":{"b":1}}}')) }, { 'a.b': 1 });
  assert.deepEqual({ ...parseQuota(Buffer.from('{"data":{"x":true}}')) }, { x: true });
  assert.equal(parseQuota(Buffer.from('kein json')), null);
  assert.equal(parseQuota(Buffer.from('{"foo":1}')), null);
});

test('parseStatus', () => {
  assert.equal(parseStatus(Buffer.from('{"params":{"status":1}}')), true);
  assert.equal(parseStatus(Buffer.from('{"params":{"status":0}}')), false);
  assert.equal(parseStatus(Buffer.from('{"foo":1}')), null);
  assert.equal(parseStatus(Buffer.from('x')), null);
});

test('buildSignature: sortierte Parameter, deterministisch, HMAC-SHA256 hex', () => {
  const base = { accessKey: 'AK', secretKey: 'SK', nonce: '123456', timestamp: '1700000000000' };
  const a = buildSignature({ ...base, params: { sn: 'X', b: '2' } });
  const b = buildSignature({ ...base, params: { b: '2', sn: 'X' } });
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
  // Referenzwert unabhängig berechnet: HMAC-SHA256("b=2&sn=X&accessKey=AK&nonce=123456&timestamp=1700000000000", "SK")
  const ref = require('node:crypto')
    .createHmac('sha256', 'SK')
    .update('b=2&sn=X&accessKey=AK&nonce=123456&timestamp=1700000000000')
    .digest('hex');
  assert.equal(a, ref);
  assert.notEqual(a, buildSignature({ ...base, params: { sn: 'Y', b: '2' } }));
});

test('describeEntity: eindeutige Einheiten, keine geratenen Spannungen', () => {
  assert.equal(describeEntity('pd.soc', 50).deviceClass, 'battery');
  assert.equal(describeEntity('pd.wattsInSum', 5).unit, 'W');
  assert.equal(describeEntity('inv.outputWatts', 5).primary, true);
  assert.equal(describeEntity('bms.cellTemp', 20).unit, '°C');
  assert.equal(describeEntity('bms_bmsStatus.vol', 51000).unit, undefined);
  assert.equal(describeEntity('pd.remainTime', 100).unit, 'min');
  assert.equal(describeEntity('pd.model', 'abc').stateClass, undefined);
});

test('describeEntity: Overrides (Skalierung, Einheit, ignore) und Template-Schutz', () => {
  const ov = [
    { regex: /Watts$/, scale: 0.1 },
    { regex: /^bms\.vol$/, scale: 0.001, unit: 'V', device_class: 'voltage' },
    { regex: /^junk\./, ignore: true },
  ];
  const w = describeEntity('pv1InputWatts', 1234, ov);
  assert.equal(w.scale, 0.1);
  assert.equal(scaleValue(1234, w), 123.4);
  const v = describeEntity('bms.vol', 51200, ov);
  assert.equal(v.unit, 'V');
  assert.equal(v.deviceClass, 'voltage');
  assert.equal(describeEntity('junk.x', 1, ov).ignore, true);
  assert.equal(describeEntity("bad'key", 1).ignore, true);
  assert.equal(scaleValue('text', { scale: 0.1 }), 'text');
});

test('buildDiscovery: Pflichtfelder, Verfügbarkeit, diagnostische Entities standardmäßig deaktiviert', () => {
  const cfg = { baseTopic: 'ecoflow_bridge', discoveryPrefix: 'homeassistant', enableAllEntities: false, version: '2.0.0' };
  const primary = buildDiscovery({ sn: 'HW1', deviceName: 'Delta', key: 'pd.soc', spec: describeEntity('pd.soc', 1), entitySlug: 'pd_soc', cfg });
  assert.equal(primary.topic, 'homeassistant/sensor/ecoflow_hw1/pd_soc/config');
  assert.equal(primary.payload.state_topic, 'ecoflow_bridge/HW1/state');
  assert.equal(primary.payload.value_template, "{{ value_json['pd.soc'] }}");
  assert.equal(primary.payload.availability_mode, 'all');
  assert.equal(primary.payload.enabled_by_default, undefined);
  const diag = buildDiscovery({ sn: 'HW1', deviceName: 'Delta', key: 'pd.x', spec: describeEntity('pd.x', 1), entitySlug: 'pd_x', cfg });
  assert.equal(diag.payload.entity_category, 'diagnostic');
  assert.equal(diag.payload.enabled_by_default, false);
  const all = buildDiscovery({ sn: 'HW1', deviceName: 'Delta', key: 'pd.x', spec: describeEntity('pd.x', 1), entitySlug: 'pd_x', cfg: { ...cfg, enableAllEntities: true } });
  assert.equal(all.payload.enabled_by_default, undefined);
});

test('Namen und Slugs', () => {
  assert.equal(prettyName('pd.wattsInSum'), 'Pd Watts In Sum');
  assert.equal(prettyName('bms_bmsStatus.cellTemp'), 'Bms Bms Status Cell Temp');
  assert.equal(slug('pd.wattsInSum'), 'pd_wattsinsum');
  assert.equal(slug('...'), 'x');
});

test('normalize: gültige Konfiguration mit Defaults', () => {
  const c = normalize({ access_key: ' AK ', secret_key: 'SK', mqtt_host: 'mqtt://broker:1883', poll_interval: 5, devices: [' A ', ''] });
  assert.equal(c.accessKey, 'AK');
  assert.equal(c.mqtt.host, 'broker');
  assert.equal(c.pollInterval, 30);
  assert.deepEqual(c.devices, [{ sn: 'A', type: null, name: null }]);
  assert.equal(c.apiHost, 'api-e.ecoflow.com');
  assert.equal(c.haDiscovery, true);
  assert.equal(c.logLevel, 'info');
});

test('normalize: Fehler werden gesammelt gemeldet', () => {
  assert.throws(() => normalize({}), /Keine Zugangsdaten/);
  assert.throws(() => normalize({ auth_mode: 'api_key' }), /access_key fehlt[\s\S]*secret_key fehlt/);
  assert.throws(() => normalize({ auth_mode: 'email', ecoflow_email: 'a@b.de' }), /ecoflow_password fehlt[\s\S]*devices/);
  assert.throws(() => normalize({ access_key: 'a', secret_key: 'b', overrides: [{ match: '(' }] }), /regulärer Ausdruck/);
  assert.throws(() => normalize({ access_key: 'a', secret_key: 'b', overrides: [{ match: 'x', scale: 0 }] }), /scale/);
  assert.throws(() => normalize({ access_key: 'a', secret_key: 'b', mqtt_port: 70000 }), /mqtt_port/);
});

test('Logger schwärzt Geheimnisse', () => {
  addSecret('supergeheim123');
  assert.equal(redact('key=supergeheim123!'), 'key=***!');
});

test('normalize: Anmeldeart automatisch, Keys haben Vorrang, E-Mail braucht Seriennummern', () => {
  assert.equal(normalize({ access_key: 'a', secret_key: 'b' }).authMode, 'api_key');
  const em = normalize({ ecoflow_email: 'a@b.de', ecoflow_password: 'pw', devices: ['SN1'] });
  assert.equal(em.authMode, 'email');
  assert.equal(em.email, 'a@b.de');
  // beides gesetzt: auto nimmt die Developer-API, explizit email erzwingt den App-Login
  const both = { access_key: 'a', secret_key: 'b', ecoflow_email: 'a@b.de', ecoflow_password: 'pw', devices: ['SN1'] };
  assert.equal(normalize(both).authMode, 'api_key');
  assert.equal(normalize({ ...both, auth_mode: 'email' }).authMode, 'email');
  assert.throws(() => normalize({ ecoflow_email: 'a@b.de', ecoflow_password: 'pw' }), /Seriennummern/);
});

test('parseQuota/parseStatus: App-Format data.quotaMap und data.online', () => {
  assert.deepEqual({ ...parseQuota(Buffer.from('{"data":{"quotaMap":{"pd.soc":42}}}')) }, { 'pd.soc': 42 });
  assert.equal(parseStatus(Buffer.from('{"data":{"online":0}}')), false);
});

test('normalize: devices als Objekte mit Typ (inkl. Alias) und Fehlerfälle', () => {
  const c = normalize({
    ecoflow_email: 'a@b.de', ecoflow_password: 'pw',
    devices: [{ sn: 'HW51', type: 'pstream800', name: 'Balkon' }, { sn: 'R331', type: 'delta2' }, 'X1'],
  });
  assert.deepEqual(c.devices, [
    { sn: 'HW51', type: 'pstream', name: 'Balkon' },
    { sn: 'R331', type: 'delta2', name: null },
    { sn: 'X1', type: null, name: null },
  ]);
  const base = { ecoflow_email: 'a@b.de', ecoflow_password: 'pw' };
  assert.throws(() => normalize({ ...base, devices: [{ sn: 'A', type: 'gibtsnicht' }] }), /unbekannter Gerätetyp "gibtsnicht"/);
  assert.throws(() => normalize({ ...base, devices: [{ sn: 'A' }, { sn: 'A' }] }), /doppelt/);
  assert.throws(() => normalize({ ...base, devices: [{ type: 'pstream' }] }), /sn fehlt/);
});

test('describeEntity: Katalog-Metadaten (Skalierung, Einheit, Name) vor Heuristik', () => {
  const { lookupMeta } = require('../src/catalog');
  const m = lookupMeta('pstream', 'inverter_heartbeat.pv1InputVolt');
  assert.equal(m.mult, 0.1);
  const spec = describeEntity('inverter_heartbeat.pv1InputVolt', 412, [], m);
  assert.equal(spec.unit, 'V');
  assert.equal(spec.deviceClass, 'voltage');
  assert.equal(spec.scale, 0.1);
  assert.equal(scaleValue(412, spec), 41.2);
  assert.equal(spec.name, 'PV1 input voltage');
  // Developer-API liefert den Feldnamen ohne Nachrichtenkanal -> eindeutiger Treffer über den Feldnamen
  assert.equal(lookupMeta('pstream', 'invOutputWatts').mult, 0.1);
  // JSON-Gerät: Alias bms_bmsStatus -> bmsMaster
  assert.equal(lookupMeta('delta2', 'bms_bmsStatus.amp').unit, 'A');
  assert.equal(lookupMeta('delta2', 'gibt.es.nicht'), undefined);
  assert.equal(lookupMeta('gibtsnicht', 'x'), undefined);
});

test('config.yaml: Typauswahl entspricht exakt dem Gerätekatalog, Übersetzungen decken die Felder ab', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const text = fs.readFileSync(path.join(__dirname, '..', 'config.yaml'), 'utf8');
  const m = text.match(/type: list\(([^)]*)\)\?/);
  assert.ok(m, 'devices.type als list(...) im Schema');
  const { listTypes } = require('../src/catalog');
  assert.deepEqual(m[1].split('|').sort(), listTypes().sort());
  for (const lang of ['de', 'en']) {
    const t = fs.readFileSync(path.join(__dirname, '..', 'translations', `${lang}.yaml`), 'utf8');
    for (const f of ['sn:', 'type:', 'name:', 'fields:']) assert.ok(t.includes(f), `${lang}: ${f}`);
  }
});
