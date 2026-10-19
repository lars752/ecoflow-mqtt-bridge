'use strict';
/** Konfiguration sichern und laden (JSON). */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { exportConfig, prepareImport, OPTION_KEYS, FORMAT } = require('../src/configio');
const { createWebUi } = require('../src/webui');
const { normalize } = require('../src/config');

const silent = { debug() {}, info() {}, warn() {}, error() {} };

const current = {
  auth_mode: 'auto',
  ecoflow_email: 'haus@example.com',
  ecoflow_password: 'geheim1',
  ecoflow_mqtt_username: 'app-x',
  ecoflow_mqtt_password: 'mqtt-geheim',
  access_key: '',
  secret_key: '',
  api_host: 'api-e.ecoflow.com',
  poll_interval: 300,
  mqtt_host: '127.0.0.1',
  mqtt_port: 1883,
  mqtt_password: 'broker-pw',
  ha_discovery: false,
  discovery_prefix: 'homeassistant',
  enable_all_entities: false,
  log_level: 'info',
  overrides: [],
  accounts: [{ name: 'Garten', email: 'garten@example.com', password: 'geheim2', mqtt_password: 'mqtt2' }],
  devices: [
    { sn: 'HW51AAAA00000001', type: 'pstream800', name: 'PS Haus' },
    { sn: 'HW51BBBB00000002', type: 'pstream800', name: 'PS Garten', account: 'Garten' },
  ],
  unrelated_supervisor_key: 'x',
};

test('Export: nur bekannte Optionen, Passwörter standardmäßig leer', () => {
  const doc = exportConfig(current, { version: '3.4.0', now: new Date('2026-10-18T12:00:00Z') });
  assert.equal(doc.format, FORMAT);
  assert.equal(doc.version, 1);
  assert.equal(doc.addon_version, '3.4.0');
  assert.equal(doc.secrets_included, false);
  assert.ok(!('unrelated_supervisor_key' in doc.options));
  assert.equal(doc.options.ecoflow_email, 'haus@example.com');
  assert.equal(doc.options.ecoflow_password, '');
  assert.equal(doc.options.ecoflow_mqtt_password, '');
  assert.equal(doc.options.mqtt_password, '');
  assert.equal(doc.options.accounts[0].password, '');
  assert.equal(doc.options.accounts[0].mqtt_password, '');
  assert.equal(doc.options.accounts[0].email, 'garten@example.com');
  assert.deepEqual(doc.options.devices, current.devices);
  // Original bleibt unverändert
  assert.equal(current.ecoflow_password, 'geheim1');
  assert.equal(current.accounts[0].password, 'geheim2');
  assert.ok(Object.keys(doc.options).every((k) => OPTION_KEYS.includes(k)));
});

test('Export mit Passwörtern', () => {
  const doc = exportConfig(current, { includeSecrets: true });
  assert.equal(doc.secrets_included, true);
  assert.equal(doc.options.ecoflow_password, 'geheim1');
  assert.equal(doc.options.accounts[0].password, 'geheim2');
});

test('Import: Roundtrip ohne Passwörter übernimmt Passwörter aus der aktuellen Konfiguration', () => {
  const doc = exportConfig(current);
  doc.options.devices.push({ sn: 'HW51CCCC00000003', type: 'pstream800', name: 'Neu' });
  doc.options.poll_interval = 600;
  const r = prepareImport(JSON.stringify(doc), current, { version: '3.4.0' });
  assert.equal(r.options.ecoflow_password, 'geheim1');
  assert.equal(r.options.accounts[0].password, 'geheim2');
  assert.equal(r.options.accounts[0].mqtt_password, 'mqtt2');
  assert.equal(r.options.mqtt_password, 'broker-pw');
  assert.equal(r.options.poll_interval, 600);
  assert.equal(r.options.devices.length, 3);
  assert.equal(r.options.unrelated_supervisor_key, 'x', 'Fremde Schlüssel bleiben unberührt');
  assert.deepEqual(r.summary, { accounts: 2, devices: 3 });
  assert.ok(r.warnings.some((w) => /übernommen/.test(w)));
});

test('Import: Datei mit Passwörtern ersetzt sie; Konto wird über den Namen zugeordnet', () => {
  const doc = exportConfig(current, { includeSecrets: true });
  doc.options.ecoflow_password = 'neues-pw';
  doc.options.accounts[0].password = 'neues-pw-2';
  const r = prepareImport(doc, current);
  assert.equal(r.options.ecoflow_password, 'neues-pw');
  assert.equal(r.options.accounts[0].password, 'neues-pw-2');
});

test('Import: nacktes Optionsobjekt, neue Konten, unbekannte Schlüssel gemeldet', () => {
  const r = prepareImport(
    { ...current, accounts: [{ name: 'Neu', email: 'n@x.de', password: 'p' }], devices: [{ sn: 'S1', account: 'Neu' }], foo: 1 },
    current,
  );
  assert.equal(r.options.accounts[0].name, 'Neu');
  assert.equal(r.options.accounts[0].password, 'p');
  assert.ok(r.warnings.some((w) => /foo/.test(w)));
  assert.ok(!('foo' in r.options));
});

test('Import: Fehler bei ungültigem JSON, fremdem Format, neuer Version und ungültiger Konfiguration', () => {
  assert.throws(() => prepareImport('{kaputt', current), /Ungültiges JSON/);
  assert.throws(() => prepareImport('[1]', current), /JSON-Objekt erwartet/);
  assert.throws(() => prepareImport({ format: 'anderes', options: {} }, current), /Unbekanntes Format/);
  assert.throws(() => prepareImport({ format: FORMAT, version: 99, options: {} }, current), /neueren Version/);
  assert.throws(() => prepareImport({ options: { ...current, devices: [{ sn: 'S1', account: 'Gibtsnicht' }] } }, current), /unbekanntes Konto/);
  assert.throws(() => prepareImport({ options: { ...current, devices: [{ sn: 'S1', type: 'quatsch' }] } }, current), /unbekannter Gerätetyp/);
});

const request = (port, method, urlPath, { headers = {}, body } = {}) =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });

function makeUi({ saveFails = false } = {}) {
  const config = normalize(current, '3.4.0');
  const state = { saved: [], restarts: 0 };
  const accounts = config.accounts.map((acc) => ({ id: acc.id, name: acc.name, config: acc, api: { preset: null }, cloud: {}, bridge: { devices: new Map() } }));
  const ui = createWebUi({
    config,
    app: { accounts },
    logger: silent,
    saveOptions: async (p) => {
      if (saveFails) throw new Error('Supervisor nicht erreichbar');
      state.saved.push(p);
    },
    readOptions: () => JSON.parse(JSON.stringify(current)),
    restart: async () => void state.restarts++,
    allowAny: true,
  });
  return { ui, state };
}

test('WebUI: Export als Download, mit und ohne Passwörter', async (t) => {
  const { ui } = makeUi();
  const port = await ui.listen(0, '127.0.0.1');
  t.after(() => ui.close());
  const plain = await request(port, 'GET', '/export?secrets=0');
  assert.equal(plain.status, 200);
  assert.match(plain.headers['content-disposition'], /attachment; filename="ecoflow-config\.json"/);
  const doc = JSON.parse(plain.body);
  assert.equal(doc.options.ecoflow_password, '');
  assert.ok(!plain.body.includes('geheim1'));
  const full = JSON.parse((await request(port, 'GET', '/export?secrets=1')).body);
  assert.equal(full.options.ecoflow_password, 'geheim1');
  assert.equal(full.secrets_included, true);
  const page = (await request(port, 'GET', '/')).body;
  assert.match(page, /Konfiguration sichern und laden/);
  assert.match(page, /href="export\?secrets=0"/);
});

test('WebUI: Import speichert die geprüfte Konfiguration und startet optional neu', async (t) => {
  const { ui, state } = makeUi();
  const port = await ui.listen(0, '127.0.0.1');
  t.after(() => ui.close());
  const post = (b, headers = { 'x-requested-with': 'ecoflow-ui' }) =>
    request(port, 'POST', '/import', { headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(b) });

  assert.equal((await post({ config: {} }, {})).status, 400, 'ohne X-Requested-With abgelehnt');

  const bad = await post({ config: { options: { ...current, devices: [{ sn: 'S1', account: 'x' }] } } });
  assert.equal(bad.status, 400);
  assert.match(JSON.parse(bad.body).error, /unbekanntes Konto/);
  assert.equal(state.saved.length, 0);

  const doc = exportConfig(current);
  doc.options.poll_interval = 900;
  const ok = await post({ config: doc, restart: true });
  assert.equal(ok.status, 200);
  const j = JSON.parse(ok.body);
  assert.equal(j.ok, true);
  assert.equal(j.restarting, true);
  assert.match(j.message, /2 Konto\/Konten, 2 Gerät/);
  assert.equal(state.saved[0].poll_interval, 900);
  assert.equal(state.saved[0].ecoflow_password, 'geheim1');
  await new Promise((r) => setTimeout(r, 1000));
  assert.equal(state.restarts, 1);

  const noRestart = await post({ config: doc, restart: false });
  assert.equal(JSON.parse(noRestart.body).restarting, false);
  await new Promise((r) => setTimeout(r, 1000));
  assert.equal(state.restarts, 1, 'ohne Haken kein Neustart');
});

test('WebUI: Speicherfehler wird gemeldet, kein Neustart', async (t) => {
  const { ui, state } = makeUi({ saveFails: true });
  const port = await ui.listen(0, '127.0.0.1');
  t.after(() => ui.close());
  const res = await request(port, 'POST', '/import', {
    headers: { 'content-type': 'application/json', 'x-requested-with': 'ecoflow-ui' },
    body: JSON.stringify({ config: exportConfig(current), restart: true }),
  });
  assert.equal(res.status, 502);
  assert.match(JSON.parse(res.body).error, /Supervisor nicht erreichbar/);
  await new Promise((r) => setTimeout(r, 1000));
  assert.equal(state.restarts, 0);
});
