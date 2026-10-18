'use strict';
/**
 * Speichern der erzeugten EcoFlow-MQTT-Zugangsdaten in den Add-on-Optionen (Supervisor-API),
 * damit sie – wie im ioBroker-Adapter – in der Konfiguration sichtbar sind und einen Neustart überdauern.
 */
const fs = require('node:fs');

const DEFAULT_OPTIONS_PATH = '/data/options.json';
const SUPERVISOR = 'http://supervisor';

/** Abbildung Zugangsdaten -> Optionsnamen. */
function credentialPatch(creds) {
  return {
    ecoflow_mqtt_user_id: creds.userId ? String(creds.userId) : '',
    ecoflow_mqtt_username: creds.account,
    ecoflow_mqtt_password: creds.password,
    ecoflow_mqtt_client_id: creds.clientId,
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

/** Führt `patch` mit den aktuellen Optionen zusammen und schreibt alles zurück. */
async function saveOptions(patch, { env = process.env, fetchImpl = fetch, optionsPath } = {}) {
  const file = optionsPath || env.OPTIONS_PATH || DEFAULT_OPTIONS_PATH;
  const current = recent && Date.now() - recent.at < RECENT_MS ? recent.options : JSON.parse(fs.readFileSync(file, 'utf8'));
  const options = { ...current, ...patch };
  await supervisorCall('/addons/self/options', { options }, { env, fetchImpl });
  recent = { at: Date.now(), options };
}

function resetRecent() {
  recent = null;
}

async function restartSelf(opts = {}) {
  await supervisorCall('/addons/self/restart', null, opts);
}

/** Persistiert neu erzeugte Zugangsdaten, wenn sie von den gespeicherten abweichen (best effort). */
function createPersister({ config, logger, env, fetchImpl, optionsPath }) {
  let warned = false;
  return async (creds) => {
    const known = config.presetMqtt;
    if (known && known.account === creds.account && known.password === creds.password && known.clientId === creds.clientId) return;
    try {
      await saveOptions(credentialPatch(creds), { env, fetchImpl, optionsPath });
      config.presetMqtt = { ...creds };
      logger.info('MQTT-Zugangsdaten wurden in den Add-on-Optionen gespeichert.');
    } catch (err) {
      if (!warned) logger.warn(`MQTT-Zugangsdaten konnten nicht in den Optionen gespeichert werden (${err.message}); sie werden bei jedem Start neu erzeugt.`);
      warned = true;
    }
  };
}

module.exports = { credentialPatch, saveOptions, restartSelf, createPersister, resetRecent };
