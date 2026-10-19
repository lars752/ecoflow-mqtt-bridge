'use strict';
/** Mehrere EcoFlow-Konten: Konfiguration, Speichern, Weboberfläche, App-Aufbau. */
const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const http = require('node:http');
const { normalize } = require('../src/config');
const { accountPatch } = require('../src/credentials');
const { createApp } = require('../src/app');
const { LocalMqtt } = require('../src/local');
const { createWebUi } = require('../src/webui');

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const raw = {
  ecoflow_email: 'haus@example.com',
  ecoflow_password: 'pw1',
  accounts: [
    { name: 'Garten', email: 'garten@example.com', password: 'pw2' },
    { name: 'Werkstatt', access_key: 'ak', secret_key: 'sk' },
  ],
  devices: [
    { sn: 'HW51AAAA00000001', type: 'pstream800', name: 'PS Haus' },
    { sn: 'HW51BBBB00000002', type: 'pstream800', name: 'PS Garten', account: 'Garten' },
    { sn: 'R331CCCC00000003', type: 'delta2', account: 'werkstatt' },
    { sn: 'HW51DDDD00000004', type: 'pstream800', account: 'garten@example.com', name: 'PS Garten 2' },
  ],
};

test('normalize: Konten und Gerätezuordnung', () => {
  const c = normalize(raw);
  assert.deepEqual(c.accounts.map((a) => [a.id, a.authMode, a.devices.map((d) => d.sn)]), [
    ['haus_example_com', 'email', ['HW51AAAA00000001']],
    ['garten', 'email', ['HW51BBBB00000002', 'HW51DDDD00000004']],
    ['werkstatt', 'api_key', ['R331CCCC00000003']],
  ]);
  assert.deepEqual(c.accounts.map((a) => a.optionPath), [{ type: 'root' }, { type: 'account', index: 0 }, { type: 'account', index: 1 }]);
  // oberste Ebene spiegelt das erste Konto
  assert.equal(c.accountId, 'haus_example_com');
  assert.equal(c.email, 'haus@example.com');
  assert.deepEqual(c.devices.map((d) => d.sn), ['HW51AAAA00000001']);
  assert.equal(c.accounts[1].emailPassword, 'pw2');
});

test('normalize: nur "accounts" ohne Zugangsdaten auf oberster Ebene', () => {
  const c = normalize({ accounts: [{ name: 'A', email: 'a@x.de', password: 'p' }, { name: 'B', email: 'b@x.de', password: 'q' }], devices: [{ sn: 'S1', account: 'B' }, { sn: 'S2' }] });
  assert.deepEqual(c.accounts.map((a) => a.name), ['A', 'B']);
  assert.deepEqual(c.accounts[0].optionPath, { type: 'account', index: 0 });
  assert.deepEqual(c.accounts.map((a) => a.devices.map((d) => d.sn)), [['S2'], ['S1']]);
});

test('normalize: Fehler bei unbekanntem Konto, doppeltem Namen/Seriennummer und fehlenden Zugangsdaten', () => {
  assert.throws(() => normalize({ ...raw, devices: [{ sn: 'S1', account: 'Gibtsnicht' }] }), /unbekanntes Konto "Gibtsnicht"/);
  assert.throws(() => normalize({ ...raw, accounts: [{ name: 'Garten', email: 'g@x.de', password: 'p' }, { name: 'garten', email: 'h@x.de', password: 'p' }] }), /Kontonamen müssen eindeutig sein/);
  assert.throws(() => normalize({ ...raw, devices: [{ sn: 'S1' }, { sn: 'S1', account: 'Garten' }] }), /Seriennummer S1 doppelt/);
  assert.throws(() => normalize({ ...raw, accounts: [{ name: 'Leer' }] }), /Konto "Leer": Keine Zugangsdaten/);
  assert.throws(() => normalize({ accounts: [{ name: 'Leer', email: 'a@x.de' }] }), /Konto "Leer": ecoflow_password fehlt|Keine Zugangsdaten/);
});

test('normalize: Platzhalter-Seriennummern werden dem Konto zugeordnet übersprungen', () => {
  const c = normalize({ ...raw, devices: [{ sn: 'HW51_ERGAENZEN', name: 'X', account: 'Garten' }, { sn: 'S1' }] });
  assert.deepEqual(c.accounts[1].skippedDevices, [{ sn: 'HW51_ERGAENZEN', name: 'X' }]);
  assert.equal(c.accounts[1].devices.length, 0);
});

test('accountPatch: schreibt in das richtige Konto der Optionen', () => {
  const current = { ecoflow_email: 'haus', accounts: [{ name: 'Garten', email: 'old' }, { name: 'Werkstatt' }] };
  const creds = { userId: 7, account: 'app-u', password: 'pw-x', clientId: 'ANDROID_c_7' };

  const second = accountPatch({ name: 'Werkstatt', optionPath: { type: 'account', index: 1 } }, { email: 'neu@x.de', password: 'p', creds })(current);
  assert.deepEqual(second.accounts[0], current.accounts[0]);
  assert.deepEqual(second.accounts[1], {
    name: 'Werkstatt',
    email: 'neu@x.de',
    password: 'p',
    mqtt_user_id: '7',
    mqtt_username: 'app-u',
    mqtt_password: 'pw-x',
    mqtt_client_id: 'ANDROID_c_7',
  });

  const root = accountPatch({ name: 'Haus', optionPath: { type: 'root' } }, { creds })(current);
  assert.deepEqual(root, { ecoflow_mqtt_user_id: '7', ecoflow_mqtt_username: 'app-u', ecoflow_mqtt_password: 'pw-x', ecoflow_mqtt_client_id: 'ANDROID_c_7' });

  assert.throws(() => accountPatch({ name: 'Weg', optionPath: { type: 'account', index: 5 } }, { email: 'a' })(current), /nicht mehr in den Add-on-Optionen/);
});

test('createApp: ein Bridge/Cloud pro Konto, gemeinsame Local-Verbindung, Konto-Liste als Topic', () => {
  const config = normalize({ ...raw, mqtt_host: '127.0.0.1' });
  const published = [];
  const local = Object.assign(new EventEmitter(), { publish: (t, p, o) => published.push({ t, p, o }), connect: async () => {}, stop: async () => {} });
  const app = createApp(config, silent, { local });
  assert.deepEqual(app.accounts.map((a) => a.id), ['haus_example_com', 'garten', 'werkstatt']);
  assert.equal(new Set(app.accounts.map((a) => a.bridge)).size, 3);
  assert.ok(app.accounts.every((a) => a.bridge.local === local));
  assert.equal(app.accounts[1].api.constructor.name, 'EcoFlowAppApi');
  assert.equal(app.accounts[2].api.constructor.name, 'EcoFlowApi');
  assert.equal(app.accounts[1].bridge.cfg.accountId, 'garten');
  assert.deepEqual(app.accounts[1].bridge.cfg.devices.map((d) => d.sn), ['HW51BBBB00000002', 'HW51DDDD00000004']);

  local.emit('connect');
  const msg = published.find((p) => p.t === 'ecoflow_bridge/accounts');
  assert.equal(msg.o.retain, true);
  assert.deepEqual(JSON.parse(msg.p), [
    { id: 'haus_example_com', name: 'haus@example.com' },
    { id: 'garten', name: 'Garten' },
    { id: 'werkstatt', name: 'Werkstatt' },
  ]);
});

test('LocalMqtt: connect/stop sind für mehrere Konten idempotent', async () => {
  let connects = 0;
  const client = Object.assign(new EventEmitter(), {
    connected: true,
    publish(_t, _p, _o, cb) { cb?.(); },
    subscribe() {},
    end(_f, _o, cb) { cb(); },
  });
  const mqttLib = { connect: () => { connects++; setImmediate(() => client.emit('connect')); return client; } };
  const local = new LocalMqtt({ mqttCfg: { host: 'h', port: 1 }, baseTopic: 'b', discoveryPrefix: 'p', logger: silent, mqttLib });
  await Promise.all([local.connect(), local.connect()]);
  assert.equal(connects, 1);
  await local.stop();
  await local.stop();
});

const request = (port, method, urlPath, { headers = {}, body } = {}) =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });

function makeAccountUi() {
  const config = normalize(raw);
  const calls = [];
  const options = { ecoflow_email: 'haus@example.com', accounts: [{ name: 'Garten', email: 'garten@example.com' }, { name: 'Werkstatt' }] };
  const accounts = config.accounts.map((acc) => ({
    id: acc.id,
    name: acc.name,
    config: acc,
    api: {
      preset: null,
      createCredentials: async (v) => {
        calls.push(['create', acc.id, v.email, v.password]);
        return { userId: 9, account: `app-${acc.id}`, password: 'geheim', url: 'mqtt-e.ecoflow.com', port: 8883, protocol: 'mqtts', clientId: `ANDROID_${acc.id}` };
      },
    },
    cloud: { reconnectNow: async () => void calls.push(['reconnect', acc.id]) },
    bridge: { devices: new Map(acc.devices.map((d) => [d.sn, { ...d, online: false }])) },
  }));
  const saveOptions = async (p) => void calls.push(['save', typeof p === 'function' ? p(options) : p]);
  const ui = createWebUi({ config, app: { accounts }, logger: silent, saveOptions, allowAny: true });
  return { ui, calls };
}

test('WebUI: je Konto ein Abschnitt, Erstellen betrifft nur das gewählte Konto', async (t) => {
  const { ui, calls } = makeAccountUi();
  const port = await ui.listen(0, '127.0.0.1');
  t.after(() => ui.close());

  const page = (await request(port, 'GET', '/')).body;
  assert.equal((page.match(/<section class="card"/g) || []).length, 3);
  assert.match(page, /data-account="garten"/);
  assert.match(page, /<h1 class="acc">Garten<\/h1>/);
  assert.match(page, /PS Garten 2/);
  assert.match(page, /Dieses Konto läuft im API-Key-Modus/);

  const post = (b) => request(port, 'POST', '/create', { headers: { 'content-type': 'application/json', 'x-requested-with': 'ecoflow-ui' }, body: JSON.stringify(b) });
  const res = await post({ account: 'garten', email: 'neu@example.com', password: 'neuespw' });
  assert.equal(res.status, 200);
  assert.ok(!res.body.includes('geheim') && !res.body.includes('neuespw'));
  assert.equal(JSON.parse(res.body).credentials.username, 'app-garten');
  assert.deepEqual(calls[0], ['create', 'garten', 'neu@example.com', 'neuespw']);
  assert.deepEqual(calls[1][1].accounts[0], { name: 'Garten', email: 'neu@example.com', password: 'neuespw' });
  assert.equal(calls[1][1].accounts[1].name, 'Werkstatt');
  assert.deepEqual(calls[2], ['reconnect', 'garten']);

  assert.equal((await post({ account: 'unbekannt', email: 'a@b.de', password: 'x' })).status, 400);
  assert.equal((await post({ account: 'werkstatt', email: 'a@b.de', password: 'x' })).status, 400, 'API-Key-Konto hat keinen Login-Button');
});
