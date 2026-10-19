'use strict';
/**
 * Konfiguration sichern und laden (JSON): Export der Add-on-Optionen und validierter Import.
 * Passwörter/Keys werden beim Export standardmäßig weggelassen und beim Import aus der aktuellen
 * Konfiguration übernommen, wenn sie in der Datei fehlen.
 */
const { normalize } = require('./config');

const FORMAT = 'ecoflow-mqtt-bridge-config';
const FORMAT_VERSION = 1;

// Alle Optionen aus config.yaml (nur diese werden exportiert/importiert)
const OPTION_KEYS = [
  'account_name',
  'accounts',
  'auth_mode',
  'ecoflow_email',
  'ecoflow_password',
  'ecoflow_mqtt_broker',
  'ecoflow_mqtt_port',
  'ecoflow_mqtt_user_id',
  'ecoflow_mqtt_username',
  'ecoflow_mqtt_password',
  'ecoflow_mqtt_client_id',
  'access_key',
  'secret_key',
  'api_host',
  'devices',
  'poll_interval',
  'mqtt_host',
  'mqtt_port',
  'mqtt_user',
  'mqtt_password',
  'ha_discovery',
  'discovery_prefix',
  'enable_all_entities',
  'overrides',
  'log_level',
];
const SECRET_ROOT = ['ecoflow_password', 'ecoflow_mqtt_password', 'access_key', 'secret_key', 'mqtt_password'];
const SECRET_ACCOUNT = ['password', 'access_key', 'secret_key', 'mqtt_password'];

const clone = (v) => JSON.parse(JSON.stringify(v));
const slug = (t) => String(t ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/** Baut das Exportdokument aus den aktuellen Optionen. */
function exportConfig(options, { includeSecrets = false, version = null, now = new Date() } = {}) {
  const out = {};
  for (const key of OPTION_KEYS) if (key in options) out[key] = clone(options[key]);
  if (!includeSecrets) {
    for (const key of SECRET_ROOT) if (key in out) out[key] = '';
    if (Array.isArray(out.accounts)) {
      out.accounts = out.accounts.map((a) => {
        const copy = { ...a };
        for (const key of SECRET_ACCOUNT) if (key in copy) copy[key] = '';
        return copy;
      });
    }
  }
  return { format: FORMAT, version: FORMAT_VERSION, addon_version: version, exported_at: now.toISOString(), secrets_included: includeSecrets, options: out };
}

/**
 * Prüft ein Importdokument (Text oder Objekt) und liefert die vollständigen neuen Optionen.
 * Wirft bei ungültigem JSON, fremdem Format oder ungültiger Konfiguration.
 */
function prepareImport(input, current, { version } = {}) {
  let data = input;
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input);
    } catch (err) {
      throw new Error(`Ungültiges JSON: ${err.message}`);
    }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Die Datei enthält keine Konfiguration (JSON-Objekt erwartet)');
  if (data.format !== undefined && data.format !== FORMAT) throw new Error(`Unbekanntes Format "${data.format}" (erwartet: ${FORMAT})`);
  if (data.version !== undefined && data.version > FORMAT_VERSION) throw new Error(`Die Datei stammt aus einer neueren Version (Format ${data.version})`);
  const imported = data.options && typeof data.options === 'object' ? data.options : data;

  const warnings = [];
  const ignored = Object.keys(imported).filter((k) => !OPTION_KEYS.includes(k));
  if (ignored.length) warnings.push(`Unbekannte Einträge ignoriert: ${ignored.join(', ')}`);

  // Fehlende Optionen bleiben wie aktuell; vorhandene ersetzen sie vollständig
  const merged = { ...current };
  for (const key of OPTION_KEYS) if (key in imported) merged[key] = clone(imported[key]);

  // Leere Geheimnisse (beim Export weggelassen) aus der aktuellen Konfiguration übernehmen
  const kept = [];
  for (const key of SECRET_ROOT) {
    if (!merged[key] && current[key]) {
      merged[key] = current[key];
      kept.push(key);
    }
  }
  if (Array.isArray(merged.accounts)) {
    merged.accounts = merged.accounts.map((a) => {
      const old = (Array.isArray(current.accounts) ? current.accounts : []).find((o) => slug(o.name) === slug(a?.name));
      if (!old) return a;
      const copy = { ...a };
      for (const key of SECRET_ACCOUNT) {
        if (!copy[key] && old[key]) {
          copy[key] = old[key];
          kept.push(`${a.name}: ${key}`);
        }
      }
      return copy;
    });
  }
  if (kept.length) warnings.push(`Passwörter/Keys aus der aktuellen Konfiguration übernommen (${kept.length}), weil sie in der Datei fehlen`);

  // Nur übernehmen, was das Add-on auch starten könnte
  const config = normalize(merged, version);
  return {
    options: merged,
    warnings,
    summary: { accounts: config.accounts.length, devices: config.accounts.reduce((n, a) => n + a.devices.length, 0) },
  };
}

module.exports = { exportConfig, prepareImport, OPTION_KEYS, FORMAT };
