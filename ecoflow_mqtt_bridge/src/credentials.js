'use strict';
/**
 * Speichern der erzeugten EcoFlow-MQTT-Zugangsdaten in den Add-on-Optionen (Supervisor-API),
 * damit sie – wie im ioBroker-Adapter – in der Konfiguration sichtbar sind und einen Neustart überdauern.
 */
const fs = require('node:fs');

const DEFAULT_OPTIONS_PATH = '/data/options.json';
const SUPERVISOR = 'http://supervisor';

// Optionsnamen: klassisches Konto (oberste Ebene) bzw. Eintrag in "accounts"
const ROOT_KEYS = {
  email: 'ecoflow_email',
  password: 'ecoflow_password',
  userId: 'ecoflow_mqtt_user_id',
  username: 'ecoflow_mqtt_username',
  mqttPassword: 'ecoflow_mqtt_password',
  clientId: 'ecoflow_mqtt_client_id',
};
const ACCOUNT_KEYS = {
  email: 'email',
  password: 'password',
  userId: 'mqtt_user_id',
  username: 'mqtt_username',
  mqttPassword: 'mqtt_password',
  clientId: 'mqtt_client_id',
};

/** Abbildung Zugangsdaten -> Optionsnamen des klassischen Kontos. */
function credentialPatch(creds) {
  return credentialValues(creds, ROOT_KEYS);
}

function credentialValues(creds, keys) {
  return {
    [keys.userId]: creds.userId ? String(creds.userId) : '',
    [keys.username]: creds.account,
    [keys.mqttPassword]: creds.password,
    [keys.clientId]: creds.clientId,
  };
}

/**
 * Baut eine Änderung für die Optionen eines Kontos. `values` darf email, password und/oder
 * `creds` (erzeugte MQTT-Zugangsdaten) enthalten. Ergebnis: Funktion (aktuelle Optionen) -> Teiländerung.
 */
function accountPatch(account, values) {
  const isRoot = account.optionPath?.type !== 'account';
  const keys = isRoot ? ROOT_KEYS : ACCOUNT_KEYS;
  const changes = {};
  if (values.email) changes[keys.email] = values.email;
  if (values.password) changes[keys.password] = values.password;
  if (values.creds) Object.assign(changes, credentialValues(values.creds, keys));
  if (isRoot) return () => changes;
  return (current) => {
    const list = Array.isArray(current.accounts) ? current.accounts : [];
    const index = account.optionPath.index;
    if (!list[index]) throw new Error(`Konto ${index + 1} steht nicht mehr in den Add-on-Optionen`);
    return { accounts: list.map((a, i) => (i === index ? { ...a, ...changes } : a)) };
  };
}

async function supervisorCall(path, body, { env = process.env, fetchImpl = fetch } = {}) {
  const token = env.SUPERVISOR_TOKEN;
  if (!token) throw new Error('Kein Zugriff auf den Supervisor (SUPERVISOR_TOKEN fehlt)');
  const res = await fetchImpl(`${SUPERVISOR}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* keine JSON-Antwort */
  }
  if (!res.ok || (json && json.result && json.result !== 'ok')) {
    throw new Error(json?.message || `Supervisor-API antwortete mit HTTP ${res.status}`);
  }
  return json;
}

// Der Supervisor schreibt options.json erst verzögert neu; direkt aufeinanderfolgende Speichervorgänge
// bauen deshalb kurzzeitig auf dem zuletzt gespeicherten Stand auf, damit nichts überschrieben wird.
const RECENT_MS = 60000;
let recent = null; // { at, options }

/** Führt `patch` (Objekt oder Funktion aktuelle Optionen -> Teiländerung) mit den Optionen zusammen und schreibt alles zurück. */
async function saveOptions(patch, { env = process.env, fetchImpl = fetch, optionsPath } = {}) {
  const file = optionsPath || env.OPTIONS_PATH || DEFAULT_OPTIONS_PATH;
  const current = recent && Date.now() - recent.at < RECENT_MS ? recent.options : JSON.parse(fs.readFileSync(file, 'utf8'));
  const options = { ...current, ...(typeof patch === 'function' ? patch(current) : patch) };
  await supervisorCall('/addons/self/options', { options }, { env, fetchImpl });
  recent = { at: Date.now(), options };
}

/** Aktuelle Optionen (Stand der letzten Speicherung oder options.json). */
function readOptions({ env = process.env, optionsPath } = {}) {
  if (recent && Date.now() - recent.at < RECENT_MS) return JSON.parse(JSON.stringify(recent.options));
  return JSON.parse(fs.readFileSync(optionsPath || env.OPTIONS_PATH || DEFAULT_OPTIONS_PATH, 'utf8'));
}

function resetRecent() {
  recent = null;
}

async function restartSelf(opts = {}) {
  await supervisorCall('/addons/self/restart', null, opts);
}

/** Persistiert neu erzeugte Zugangsdaten eines Kontos, wenn sie von den gespeicherten abweichen (best effort). */
function createPersister({ account, logger, env, fetchImpl, optionsPath }) {
  let warned = false;
  return async (creds) => {
    const known = account.presetMqtt;
    if (known && known.account === creds.account && known.password === creds.password && known.clientId === creds.clientId) return;
    try {
      await saveOptions(accountPatch(account, { creds }), { env, fetchImpl, optionsPath });
      account.presetMqtt = { account: creds.account, password: creds.password, userId: creds.userId ? String(creds.userId) : null, clientId: creds.clientId };
      logger.info(`MQTT-Zugangsdaten für "${account.name}" wurden in den Add-on-Optionen gespeichert.`);
    } catch (err) {
      if (!warned) logger.warn(`MQTT-Zugangsdaten für "${account.name}" konnten nicht in den Optionen gespeichert werden (${err.message}); sie werden bei jedem Start neu erzeugt.`);
      warned = true;
    }
  };
}

module.exports = { credentialPatch, accountPatch, readOptions, saveOptions, restartSelf, createPersister, resetRecent };
