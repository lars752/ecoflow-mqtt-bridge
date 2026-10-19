'use strict';
/** Anmeldedaten erstellen: Konfiguration, App-API mit gespeicherten Zugangsdaten, Weboberfläche, Speichern. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { normalize } = require('../src/config');
const { EcoFlowAppApi } = require('../src/app-api');
const { createWebUi, renderPage, viewModel } = require('../src/webui');
const { saveOptions, createPersister, resetRecent } = require('../src/credentials');

const base = { ecoflow_email: 'a@b.de', ecoflow_password: 'pw' };

test('normalize: Platzhalter-Seriennummern werden übersprungen, ha_enable/debug übernommen', () => {
  const c = normalize({
    ...base,
    devices: [
      { sn: 'HW51ZOH4S_ERGAENZEN', type: 'pstream800', name: 'PS Akku 1 links' },
      { sn: 'HW51ZOH4SABCDEF1', type: 'pstream800', name: 'PS PV 07', ha_enable: false, debug: true },
    ],
  });
  assert.equal(c.devices.length, 1);
  assert.deepEqual(c.devices[0], { sn: 'HW51ZOH4SABCDEF1', type: 'pstream', name: 'PS PV 07', ha: false, debug: true });
  assert.deepEqual(c.skippedDevices, [{ sn: 'HW51ZOH4S_ERGAENZEN', name: 'PS Akku 1 links' }]);
  assert.deepEqual(normalize({ ...base, devices: [{ sn: 'HW51_ERGAENZEN', type: 'pstream800' }] }).devices, []);
});

test('normalize: Broker, Port und gespeicherte MQTT-Zugangsdaten', () => {
  const c = normalize({
    ...base,
    devices: ['SN1'],
    ecoflow_mqtt_broker: 'mqtts://mqtt-e.ecoflow.com',
    ecoflow_mqtt_port: 8883,
    ecoflow_mqtt_user_id: '1781',
    ecoflow_mqtt_username: 'app-abc',
    ecoflow_mqtt_password: 'secret',
    ecoflow_mqtt_client_id: 'ANDROID_x_1781',
  });
  assert.deepEqual(c.ecoflowBroker, { protocol: 'mqtts', host: 'mqtt-e.ecoflow.com', port: 8883 });
  assert.deepEqual(c.presetMqtt, { account: 'app-abc', password: 'secret', userId: '1781', clientId: 'ANDROID_x_1781' });
  const none = normalize({ ...base, devices: ['SN1'] });
  assert.equal(none.ecoflowBroker, null);
  assert.equal(none.presetMqtt, null);
  assert.throws(() => normalize({ ...base, devices: ['SN1'], ecoflow_mqtt_broker: 'mqtts://x', ecoflow_mqtt_port: 99999 }), /ecoflow_mqtt_port/);
});

test('config.yaml: Standard ohne Geräte, Broker vorbelegt, Ingress aktiv', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', 'config.yaml'), 'utf8');
  const opts = text.slice(text.indexOf('options:'), text.indexOf('schema:'));
  assert.match(opts, /devices: \[\]/);
  assert.match(opts, /ecoflow_mqtt_broker: "mqtts:\/\/mqtt-e\.ecoflow\.com"/);
  assert.match(opts, /ecoflow_mqtt_port: 8883/);
  assert.match(text, /ingress: true/);
});

function stubFetch(seen, { login = true } = {}) {
  return async (url, init = {}) => {
    seen.push({ url: String(url), init });
    const u = String(url);
    const json = (o) => ({ ok: true, status: 200, json: async () => o });
    if (u.endsWith('/auth/login')) {
      return login ? json({ code: '0', data: { token: 'TOK', user: { userId: '4711' } } }) : json({ code: '2026', message: 'password error' });
    }
    if (u.includes('/iot-auth/app/certification')) {
      return json({ code: '0', data: { certificateAccount: 'app-new', certificatePassword: 'pw-new', url: 'mqtt-x.ecoflow.com', port: '8883', protocol: 'mqtts' } });
    }
    throw new Error(`unerwartet: ${u}`);
  };
}

test('AppApi: gespeicherte Zugangsdaten ohne Login, Broker-Vorgabe, invalidate -> neuer Login', async () => {
  const seen = [];
  const saved = [];
  const api = new EcoFlowAppApi({
    email: 'a@b.de',
    password: 'pw',
    fetchImpl: stubFetch(seen),
    broker: { protocol: 'mqtts', host: 'mqtt-e.ecoflow.com', port: 8883 },
    preset: { account: 'app-old', password: 'pw-old', userId: '4711', clientId: 'ANDROID_keep_4711' },
    onCredentials: async (c) => saved.push(c),
  });
  const first = await api.getMqttCredentials();
  assert.equal(seen.length, 0, 'kein Login nötig');
  assert.equal(first.account, 'app-old');
  assert.equal(first.url, 'mqtt-e.ecoflow.com');
  assert.equal(first.clientId, 'ANDROID_keep_4711');

  api.invalidate();
  const second = await api.getMqttCredentials();
  assert.equal(seen.length, 2);
  assert.equal(second.account, 'app-new');
  assert.equal(second.url, 'mqtt-e.ecoflow.com', 'konfigurierter Broker hat Vorrang vor der Server-Adresse');
  assert.equal(second.clientId, 'ANDROID_keep_4711', 'Client-ID bleibt für dasselbe Konto stabil');
  assert.equal(saved.length, 1);
  assert.equal(saved[0].url, 'mqtt-x.ecoflow.com', 'gespeichert wird, was der Server geliefert hat');
});

test('AppApi: gespeicherte Zugangsdaten ohne Broker sind unbrauchbar -> Login', async () => {
  const seen = [];
  const api = new EcoFlowAppApi({ email: 'a@b.de', password: 'pw', fetchImpl: stubFetch(seen), preset: { account: 'x', password: 'y' } });
  const c = await api.getMqttCredentials();
  assert.equal(c.account, 'app-new');
  assert.match(c.clientId, /^ANDROID_[0-9a-f-]{36}_4711$/);
});

function makeUi({ allowAny = true, fetchOk = true } = {}) {
  const seen = [];
  const config = normalize({ ...base, devices: [{ sn: 'HW51ZOH4SABCDEF1', type: 'pstream800', name: 'PS <b>1</b>' }], ecoflow_mqtt_broker: 'mqtts://mqtt-e.ecoflow.com' });
  const api = new EcoFlowAppApi({ email: config.email, password: config.emailPassword, fetchImpl: stubFetch(seen, { login: fetchOk }), broker: config.ecoflowBroker });
  const calls = { reconnect: 0, saved: [] };
  const cloud = { reconnectNow: async () => void calls.reconnect++ };
  const bridge = { devices: new Map([['HW51ZOH4SABCDEF1', { sn: 'HW51ZOH4SABCDEF1', name: 'PS <b>1</b>', type: 'pstream', ha: true, debug: false, online: true }]]) };
  const app = { accounts: [{ id: config.accounts[0].id, name: config.accounts[0].name, config: config.accounts[0], api, cloud, bridge }] };
  const logger = { debug() {}, info() {}, warn() {}, error() {} };
  const ui = createWebUi({ config, app, logger, saveOptions: async (p) => void calls.saved.push(typeof p === 'function' ? p({}) : p), allowAny });
  return { ui, calls, config, api, bridge, app, seen };
}

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

test('WebUI: Seite escaped Werte und zeigt Maske; Zugriff nur über Ingress', async (t) => {
  const locked = makeUi({ allowAny: false });
  const lp = await locked.ui.listen(0, '127.0.0.1');
  t.after(() => locked.ui.close());
  assert.equal((await request(lp, 'GET', '/')).status, 403);

  const { ui } = makeUi();
  const port = await ui.listen(0, '127.0.0.1');
  t.after(() => ui.close());
  const page = await request(port, 'GET', '/');
  assert.equal(page.status, 200);
  assert.match(page.body, /Anmeldedaten erstellen/); assert.ok(!page.body.includes('class="acc"'), 'bei einem Konto keine Kontoüberschrift');
  assert.match(page.body, /mqtts:\/\/mqtt-e\.ecoflow\.com/);
  assert.ok(!page.body.includes('PS <b>1</b>'), 'Gerätename muss escaped sein');
  assert.match(page.body, /PS &lt;b&gt;1&lt;\/b&gt;/);
  assert.equal((await request(port, 'GET', '/gibtsnicht')).status, 404);
});

test('WebUI: Anmeldedaten erstellen speichert, verbindet neu und gibt das Passwort nie aus', async (t) => {
  const { ui, calls, api } = makeUi();
  const port = await ui.listen(0, '127.0.0.1');
  t.after(() => ui.close());
  const post = (headers, body) => request(port, 'POST', '/create', { headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

  assert.equal((await post({}, { email: 'a@b.de', password: 'x' })).status, 400, 'ohne X-Requested-With abgelehnt');

  const res = await post({ 'x-requested-with': 'ecoflow-ui' }, { email: 'neu@b.de', password: 'neues-pw' });
  assert.equal(res.status, 200);
  const j = JSON.parse(res.body);
  assert.equal(j.ok, true);
  assert.equal(j.credentials.username, 'app-new');
  assert.equal(j.credentials.userId, '4711');
  assert.equal(j.credentials.broker, 'mqtts://mqtt-e.ecoflow.com');
  assert.ok(!res.body.includes('pw-new') && !res.body.includes('neues-pw'), 'keine Passwörter in der Antwort');
  assert.equal(calls.reconnect, 1);
  assert.deepEqual(calls.saved, [{ ecoflow_email: 'neu@b.de', ecoflow_password: 'neues-pw' }]);
  assert.equal(api.preset.account, 'app-new');
});

test('WebUI: falsches Passwort -> Fehlermeldung, nichts gespeichert', async (t) => {
  const { ui, calls } = makeUi({ fetchOk: false });
  const port = await ui.listen(0, '127.0.0.1');
  t.after(() => ui.close());
  const res = await request(port, 'POST', '/create', {
    headers: { 'content-type': 'application/json', 'x-requested-with': 'ecoflow-ui' },
    body: JSON.stringify({ email: 'a@b.de', password: 'falsch' }),
  });
  assert.equal(res.status, 502);
  assert.match(JSON.parse(res.body).error, /password error/);
  assert.deepEqual(calls.saved, []);
  assert.equal(calls.reconnect, 0);
});

test('renderPage: API-Key-Modus zeigt Hinweis statt Anmeldemaske', () => {
  const config = normalize({ access_key: 'a', secret_key: 'b' });
  const html = renderPage(viewModel({ config, app: { accounts: [{ id: config.accounts[0].id, name: config.accounts[0].name, config: config.accounts[0], api: {}, bridge: { devices: new Map() } }] } }));
  assert.match(html, /nur im E-Mail-Modus aktiv/);
  assert.ok(!html.includes('class="create"'));
});

test('saveOptions/createPersister: Optionen zusammenführen, Supervisor-Aufruf, kein Überschreiben bei Folgespeichern', async () => {
  resetRecent();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opts-'));
  const file = path.join(dir, 'options.json');
  fs.writeFileSync(file, JSON.stringify({ ecoflow_email: 'a@b.de', log_level: 'info' }));
  const bodies = [];
  const fetchImpl = async (url, init) => {
    bodies.push({ url, auth: init.headers.Authorization, body: JSON.parse(init.body) });
    return { ok: true, status: 200, json: async () => ({ result: 'ok' }) };
  };
  const env = { SUPERVISOR_TOKEN: 'T' };
  await saveOptions({ ecoflow_email: 'neu@b.de' }, { env, fetchImpl, optionsPath: file });
  // options.json wurde (noch) nicht neu geschrieben -> zweiter Speichervorgang darf die E-Mail nicht verlieren
  const config = { name: 'Konto 1', optionPath: { type: 'root' }, presetMqtt: null };
  const logger = { info() {}, warn() {} };
  const persist = createPersister({ account: config, logger, env, fetchImpl, optionsPath: file });
  await persist({ userId: '4711', account: 'app-new', password: 'pw-new', clientId: 'ANDROID_x_4711' });
  assert.equal(bodies[0].url, 'http://supervisor/addons/self/options');
  assert.equal(bodies[0].auth, 'Bearer T');
  assert.deepEqual(bodies[1].body.options, {
    ecoflow_email: 'neu@b.de',
    log_level: 'info',
    ecoflow_mqtt_user_id: '4711',
    ecoflow_mqtt_username: 'app-new',
    ecoflow_mqtt_password: 'pw-new',
    ecoflow_mqtt_client_id: 'ANDROID_x_4711',
  });
  // gleiche Zugangsdaten nochmal -> kein erneuter Aufruf
  await persist({ userId: '4711', account: 'app-new', password: 'pw-new', clientId: 'ANDROID_x_4711' });
  assert.equal(bodies.length, 2);
  resetRecent();
  await assert.rejects(() => saveOptions({}, { env: {}, fetchImpl, optionsPath: file }), /SUPERVISOR_TOKEN/);
});
