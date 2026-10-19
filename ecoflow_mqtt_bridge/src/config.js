'use strict';
/**
 * Konfiguration: liest /data/options.json (Home Assistant) und validiert sie.
 * Fehlt mqtt_host, wird der MQTT-Dienst über die Supervisor-API ermittelt
 * (services: mqtt:want in config.yaml).
 */
const fs = require('node:fs');
const { listTypes, resolveType } = require('./catalog');

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'];
const DEFAULT_OPTIONS_PATH = '/data/options.json';

function readOptionsFile(path) {
  if (!fs.existsSync(path)) {
    throw new Error(`Optionsdatei nicht gefunden: ${path}`);
  }
  try {
    return JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`Optionsdatei ${path} ist kein gültiges JSON: ${err.message}`);
  }
}

const str = (v) => (typeof v === 'string' ? v.trim() : '');

const slug = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

// Platzhalter-Seriennummern aus den Standardwerten (z. B. "HW51ZOH4S_ERGAENZEN") werden übersprungen
const PLACEHOLDER_SN = /ERG(AE|Ä)NZEN/i;

/** Validiert und normalisiert die rohen Add-on-Optionen (rein, ohne I/O). */
function normalize(raw, version = '0.0.0') {
  const errors = [];

  // --- Geräte (alle Konten in einer Liste; "account" ordnet ein Gerät einem Konto zu) ---
  const allDevices = [];
  const skippedAll = [];
  for (const [i, d] of (Array.isArray(raw.devices) ? raw.devices : []).entries()) {
    const entry = typeof d === 'string' ? { sn: d } : d || {};
    const sn = str(entry.sn);
    if (!sn) {
      if (typeof d !== 'string') errors.push(`devices[${i}]: sn fehlt`);
      continue;
    }
    const accountRef = str(entry.account);
    if (PLACEHOLDER_SN.test(sn)) {
      skippedAll.push({ sn, name: str(entry.name) || null, accountRef });
      continue;
    }
    const rawType = str(entry.type);
    let type = null;
    if (rawType) {
      type = resolveType(rawType);
      if (!type) errors.push(`devices[${i}] (${sn}): unbekannter Gerätetyp "${rawType}". Erlaubt: ${listTypes().join(', ')}`);
    }
    if (allDevices.some((x) => x.sn === sn)) errors.push(`devices[${i}]: Seriennummer ${sn} doppelt`);
    allDevices.push({ sn, type, name: str(entry.name) || null, ha: entry.ha_enable !== false, debug: entry.debug === true, accountRef });
  }

  // --- Konten: das klassische Konto (oberste Ebene) plus weitere Konten aus "accounts" ---
  const extraRaw = Array.isArray(raw.accounts) ? raw.accounts.filter((a) => a && typeof a === 'object') : [];
  const legacyUsed =
    !extraRaw.length || Boolean(str(raw.access_key) || str(raw.secret_key) || str(raw.ecoflow_email) || raw.ecoflow_password || str(raw.account_name));
  const specs = [];
  if (legacyUsed) {
    specs.push({
      legacy: true,
      name: str(raw.account_name) || str(raw.ecoflow_email) || 'Konto 1',
      optionPath: { type: 'root' },
      authMode: raw.auth_mode,
      accessKey: str(raw.access_key),
      secretKey: str(raw.secret_key),
      email: str(raw.ecoflow_email),
      password: typeof raw.ecoflow_password === 'string' ? raw.ecoflow_password : '',
      apiHost: raw.api_host,
      mqtt: { userId: raw.ecoflow_mqtt_user_id, username: raw.ecoflow_mqtt_username, password: raw.ecoflow_mqtt_password, clientId: raw.ecoflow_mqtt_client_id },
    });
  }
  for (const [i, a] of extraRaw.entries()) {
    specs.push({
      legacy: false,
      name: str(a.name) || str(a.email) || `Konto ${specs.length + 1}`,
      optionPath: { type: 'account', index: i },
      authMode: a.auth_mode,
      accessKey: str(a.access_key),
      secretKey: str(a.secret_key),
      email: str(a.email),
      password: typeof a.password === 'string' ? a.password : '',
      apiHost: a.api_host,
      mqtt: { userId: a.mqtt_user_id, username: a.mqtt_username, password: a.mqtt_password, clientId: a.mqtt_client_id },
    });
  }

  const accounts = [];
  for (const spec of specs) {
    const where = spec.legacy && specs.length === 1 ? '' : `Konto "${spec.name}": `;
    // Anmeldeart: 'api_key' (Developer API) oder 'email' (App-Login wie im ioBroker-Adapter)
    const requested = ['auto', 'api_key', 'email'].includes(spec.authMode) ? spec.authMode : 'auto';
    let authMode = requested;
    if (requested === 'auto') {
      if (spec.accessKey && spec.secretKey) authMode = 'api_key';
      else if (spec.email && spec.password) authMode = 'email';
      else authMode = null;
    }
    if (!authMode) {
      errors.push(`${where}Keine Zugangsdaten: entweder access_key + secret_key (Developer API) oder ecoflow_email + ecoflow_password (App-Login) eintragen`);
    } else if (authMode === 'api_key') {
      if (!spec.accessKey) errors.push(`${where}access_key fehlt (EcoFlow Developer Portal: Access Key)`);
      if (!spec.secretKey) errors.push(`${where}secret_key fehlt (EcoFlow Developer Portal: Secret Key)`);
    } else {
      if (!spec.email) errors.push(`${where}ecoflow_email fehlt`);
      if (!spec.password) errors.push(`${where}ecoflow_password fehlt`);
    }
    const presetUser = str(spec.mqtt.username);
    const presetPass = typeof spec.mqtt.password === 'string' ? spec.mqtt.password : '';
    accounts.push({
      id: slug(spec.name) || `konto_${accounts.length + 1}`,
      name: spec.name,
      optionPath: spec.optionPath,
      authMode,
      accessKey: spec.accessKey,
      secretKey: spec.secretKey,
      email: spec.email,
      emailPassword: spec.password,
      apiHost: str(spec.apiHost).replace(/^https?:\/\//, '').replace(/\/+$/, '') || 'api-e.ecoflow.com',
      presetMqtt:
        presetUser && presetPass
          ? { account: presetUser, password: presetPass, userId: str(spec.mqtt.userId) || null, clientId: str(spec.mqtt.clientId) || null }
          : null,
      devices: [],
      skippedDevices: [],
    });
  }
  if (new Set(accounts.map((a) => a.id)).size !== accounts.length) {
    errors.push(`Kontonamen müssen eindeutig sein (aktuell: ${accounts.map((a) => a.name).join(', ')})`);
  }

  // Geräte den Konten zuordnen (ohne Angabe: erstes Konto)
  const findAccount = (ref) => (ref ? accounts.find((a) => a.id === slug(ref) || slug(a.email) === slug(ref)) : accounts[0]);
  for (const d of allDevices) {
    const acc = findAccount(d.accountRef);
    if (!acc) {
      errors.push(`Gerät ${d.sn}: unbekanntes Konto "${d.accountRef}" (Kontonamen: ${accounts.map((a) => a.name).join(', ')})`);
      continue;
    }
    const { accountRef, ...dev } = d;
    acc.devices.push(dev);
  }
  for (const d of skippedAll) {
    const acc = findAccount(d.accountRef);
    if (acc) acc.skippedDevices.push({ sn: d.sn, name: d.name });
  }

  // Bequemlichkeit/Abwärtskompatibilität: Felder des ersten Kontos auch auf oberster Ebene
  const first = accounts[0];
  const { authMode, accessKey, secretKey, email, emailPassword, apiHost, presetMqtt, devices, skippedDevices } = first;

  // Verbindungseinstellungen der EcoFlow-Cloud (E-Mail-Modus), Vorgabe wie im ioBroker-Adapter
  let ecoflowBroker = null;
  const brokerRaw = str(raw.ecoflow_mqtt_broker);
  if (brokerRaw) {
    const protocol = /^mqtt:\/\//i.test(brokerRaw) ? 'mqtt' : 'mqtts';
    const brokerHost = brokerRaw.replace(/^[a-z]+:\/\//i, '').replace(/\/+$/, '').replace(/:\d+$/, '');
    const brokerPort = Number(raw.ecoflow_mqtt_port) || (protocol === 'mqtts' ? 8883 : 1883);
    if (!brokerHost) errors.push(`ecoflow_mqtt_broker ungültig: ${raw.ecoflow_mqtt_broker}`);
    else if (!Number.isInteger(brokerPort) || brokerPort < 1 || brokerPort > 65535) errors.push(`ecoflow_mqtt_port ungültig: ${raw.ecoflow_mqtt_port}`);
    else ecoflowBroker = { protocol, host: brokerHost, port: brokerPort };
  }
  const pollInterval = Math.min(3600, Math.max(30, Number(raw.poll_interval) || 300));

  const host = str(raw.mqtt_host).replace(/^mqtts?:\/\//, '').replace(/:\d+$/, '');
  const port = Number(raw.mqtt_port) || 1883;
  if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push(`mqtt_port ungültig: ${raw.mqtt_port}`);

  const overrides = [];
  for (const [i, o] of (Array.isArray(raw.overrides) ? raw.overrides : []).entries()) {
    const match = str(o?.match);
    if (!match) {
      errors.push(`overrides[${i}]: match fehlt`);
      continue;
    }
    let regex;
    try {
      regex = new RegExp(match);
    } catch (err) {
      errors.push(`overrides[${i}]: match ist kein gültiger regulärer Ausdruck (${err.message})`);
      continue;
    }
    const entry = { regex, match };
    if (o.scale !== undefined && o.scale !== null) {
      const scale = Number(o.scale);
      if (!Number.isFinite(scale) || scale === 0) errors.push(`overrides[${i}]: scale muss eine Zahl ungleich 0 sein`);
      else entry.scale = scale;
    }
    for (const f of ['unit', 'device_class', 'state_class']) {
      if (typeof o[f] === 'string') entry[f] = o[f].trim();
    }
    if (o.ignore === true) entry.ignore = true;
    overrides.push(entry);
  }

  const logLevel = LOG_LEVELS.includes(raw.log_level) ? raw.log_level : 'info';

  if (errors.length) {
    throw new Error(`Ungültige Konfiguration:\n - ${errors.join('\n - ')}`);
  }

  return {
    version,
    authMode,
    accessKey,
    secretKey,
    email,
    emailPassword,
    apiHost,
    devices,
    skippedDevices,
    accounts,
    accountId: first.id,
    accountName: first.name,
    ecoflowBroker,
    presetMqtt,
    pollInterval,
    mqtt: {
      host,
      port,
      username: str(raw.mqtt_user),
      password: typeof raw.mqtt_password === 'string' ? raw.mqtt_password : '',
      tls: false,
    },
    haDiscovery: raw.ha_discovery !== false,
    discoveryPrefix: str(raw.discovery_prefix).replace(/^\/+|\/+$/g, '') || 'homeassistant',
    baseTopic: 'ecoflow_bridge',
    enableAllEntities: raw.enable_all_entities === true,
    overrides,
    logLevel,
  };
}

/** Ermittelt Broker-Zugangsdaten über die Supervisor-API. */
async function fetchSupervisorMqtt({ env = process.env, fetchImpl = fetch } = {}) {
  const token = env.SUPERVISOR_TOKEN;
  if (!token) return null;
  const res = await fetchImpl('http://supervisor/services/mqtt', {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Supervisor-API antwortete mit HTTP ${res.status}`);
  const body = await res.json();
  if (body.result !== 'ok' || !body.data?.host) throw new Error('Supervisor liefert keinen MQTT-Dienst');
  return {
    host: body.data.host,
    port: Number(body.data.port) || 1883,
    username: body.data.username || '',
    password: body.data.password || '',
    tls: body.data.ssl === true,
  };
}

async function loadConfig({ env = process.env, fetchImpl = fetch, version } = {}) {
  const raw = readOptionsFile(env.OPTIONS_PATH || DEFAULT_OPTIONS_PATH);
  const config = normalize(raw, version);
  if (!config.mqtt.host) {
    let svc = null;
    try {
      svc = await fetchSupervisorMqtt({ env, fetchImpl });
    } catch (err) {
      throw new Error(`mqtt_host ist leer und die automatische Erkennung schlug fehl: ${err.message}`);
    }
    if (!svc) {
      throw new Error('mqtt_host ist leer und es ist kein MQTT-Dienst des Supervisors verfügbar. Bitte mqtt_host eintragen.');
    }
    config.mqtt = svc;
  }
  return config;
}

module.exports = { loadConfig, normalize, fetchSupervisorMqtt, LOG_LEVELS };
