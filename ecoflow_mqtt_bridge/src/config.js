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

/** Validiert und normalisiert die rohen Add-on-Optionen (rein, ohne I/O). */
function normalize(raw, version = '0.0.0') {
  const errors = [];

  const accessKey = str(raw.access_key);
  const secretKey = str(raw.secret_key);
  const email = str(raw.ecoflow_email);
  const emailPassword = typeof raw.ecoflow_password === 'string' ? raw.ecoflow_password : '';
  const devices = [];
  for (const [i, d] of (Array.isArray(raw.devices) ? raw.devices : []).entries()) {
    const entry = typeof d === 'string' ? { sn: d } : d || {};
    const sn = str(entry.sn);
    if (!sn) {
      if (typeof d !== 'string') errors.push(`devices[${i}]: sn fehlt`);
      continue;
    }
    const rawType = str(entry.type);
    let type = null;
    if (rawType) {
      type = resolveType(rawType);
      if (!type) errors.push(`devices[${i}] (${sn}): unbekannter Gerätetyp "${rawType}". Erlaubt: ${listTypes().join(', ')}`);
    }
    if (devices.some((x) => x.sn === sn)) errors.push(`devices[${i}]: Seriennummer ${sn} doppelt`);
    devices.push({ sn, type, name: str(entry.name) || null });
  }

  // Anmeldeart: 'api_key' (Developer API) oder 'email' (App-Login wie im ioBroker-Adapter)
  const requested = ['auto', 'api_key', 'email'].includes(raw.auth_mode) ? raw.auth_mode : 'auto';
  let authMode = requested;
  if (requested === 'auto') {
    if (accessKey && secretKey) authMode = 'api_key';
    else if (email && emailPassword) authMode = 'email';
    else authMode = null;
  }
  if (!authMode) {
    errors.push('Keine Zugangsdaten: entweder access_key + secret_key (Developer API) oder ecoflow_email + ecoflow_password (App-Login) eintragen');
  } else if (authMode === 'api_key') {
    if (!accessKey) errors.push('access_key fehlt (EcoFlow Developer Portal: Access Key)');
    if (!secretKey) errors.push('secret_key fehlt (EcoFlow Developer Portal: Secret Key)');
  } else {
    if (!email) errors.push('ecoflow_email fehlt');
    if (!emailPassword) errors.push('ecoflow_password fehlt');
    if (!devices.length) {
      errors.push('Im E-Mail-Modus gibt es keine automatische Geräteliste: Seriennummern bitte in "devices" eintragen');
    }
  }

  const apiHost = str(raw.api_host).replace(/^https?:\/\//, '').replace(/\/+$/, '') || 'api-e.ecoflow.com';

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
