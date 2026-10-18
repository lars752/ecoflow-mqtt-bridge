'use strict';
/**
 * Abbildung von EcoFlow-Datenpunkten auf Home-Assistant-MQTT-Entities.
 *
 * Einheiten werden nur dort automatisch gesetzt, wo sie geräteübergreifend
 * eindeutig sind (soc, *Watts, *temp*, *freq*, remainTime). Spannung/Strom/Energie
 * sind je nach Gerät mV/V/0,1 V usw. und bleiben ohne Einheit, bis der Nutzer
 * über `overrides` Skalierung und Einheit festlegt.
 */
const crypto = require('node:crypto');

function tokens(key) {
  const last = key.split('.').pop();
  return last
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-\s]+/g, ' ')
    .toLowerCase()
    .split(' ')
    .filter(Boolean);
}

function prettyName(key) {
  return key
    .split('.')
    .map((seg) => seg.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_\-]+/g, ' '))
    .join(' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function slug(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'x';
}

function shortHash(text) {
  return crypto.createHash('sha1').update(text).digest('hex').slice(0, 6);
}

/** Beschreibt die Entity zu einem Datenpunkt (Einheit, Klasse, Skalierung, ...). */
// Nur Geräteklassen, die Home Assistant für Sensoren kennt – ein ungültiger Wert würde die Entity ablehnen lassen
const SENSOR_CLASSES = new Set([
  'apparent_power', 'battery', 'current', 'distance', 'duration', 'energy', 'frequency', 'humidity',
  'illuminance', 'irradiance', 'power', 'power_factor', 'pressure', 'reactive_power', 'signal_strength',
  'speed', 'temperature', 'voltage',
]);

function describeEntity(key, value, overrides = [], meta = undefined) {
  const spec = {
    name: prettyName(key),
    unit: undefined,
    deviceClass: undefined,
    stateClass: undefined,
    scale: undefined,
    ignore: false,
    primary: false,
  };

  if (typeof value === 'number') {
    const t = tokens(key);
    if (t.includes('soc')) {
      Object.assign(spec, { unit: '%', deviceClass: 'battery', stateClass: 'measurement', primary: true });
    } else if (t.includes('soh')) {
      Object.assign(spec, { unit: '%', stateClass: 'measurement' });
    } else if (t.includes('watts')) {
      Object.assign(spec, { unit: 'W', deviceClass: 'power', stateClass: 'measurement', primary: true });
    } else if (t.includes('temp')) {
      Object.assign(spec, { unit: '°C', deviceClass: 'temperature', stateClass: 'measurement' });
    } else if (t.includes('freq')) {
      Object.assign(spec, { unit: 'Hz', deviceClass: 'frequency', stateClass: 'measurement' });
    } else if (t.includes('remain') && t.includes('time')) {
      Object.assign(spec, { unit: 'min', deviceClass: 'duration', stateClass: 'measurement' });
    } else {
      spec.stateClass = 'measurement';
    }
  }

  // Gerätekatalog (Einheit, Skalierung, Name) hat Vorrang vor der Namens-Heuristik
  if (meta) {
    if (meta.name) spec.name = meta.name;
    if (typeof value === 'number') {
      spec.unit = meta.unit || undefined;
      spec.deviceClass = SENSOR_CLASSES.has(meta.device_class) ? meta.device_class : undefined;
      spec.scale = meta.mult !== undefined && meta.mult !== 1 ? meta.mult : undefined;
      spec.stateClass = spec.deviceClass === 'energy' ? 'total_increasing' : 'measurement';
      spec.primary = (spec.deviceClass === 'power' || spec.deviceClass === 'battery') && meta.category !== 'diagnostic';
    }
  }

  for (const o of overrides) {
    if (!o.regex.test(key)) continue;
    if (o.scale !== undefined) spec.scale = o.scale;
    if (o.unit !== undefined) spec.unit = o.unit;
    if (o.device_class !== undefined) spec.deviceClass = o.device_class || undefined;
    if (o.state_class !== undefined) spec.stateClass = o.state_class || undefined;
    if (o.ignore) spec.ignore = true;
  }
  // Schlüssel mit Zeichen, die das Jinja-Template brechen würden, nie als Entity anlegen
  if (/['"\\]/.test(key)) spec.ignore = true;
  return spec;
}

/** Wendet die Skalierung auf einen Wert an (nur numerisch). */
function scaleValue(value, spec) {
  if (spec.scale === undefined || typeof value !== 'number') return value;
  return Math.round(value * spec.scale * 1e6) / 1e6;
}

/** Baut Discovery-Topic und -Payload für einen Datenpunkt. */
function buildDiscovery({ sn, deviceName, key, spec, entitySlug, cfg }) {
  const devSlug = slug(sn);
  const payload = {
    name: spec.name,
    unique_id: `ecoflow_${devSlug}_${entitySlug}`,
    state_topic: `${cfg.baseTopic}/${sn}/state`,
    value_template: `{{ value_json['${key}'] }}`,
    availability: [
      { topic: `${cfg.baseTopic}/status` },
      { topic: `${cfg.baseTopic}/${sn}/availability` },
    ],
    availability_mode: 'all',
    payload_available: 'online',
    payload_not_available: 'offline',
    has_entity_name: true,
    device: {
      identifiers: [`ecoflow_${devSlug}`],
      name: deviceName,
      manufacturer: 'EcoFlow',
      serial_number: sn,
    },
    origin: { name: 'EcoFlow MQTT Bridge', sw_version: cfg.version },
  };
  if (spec.unit) payload.unit_of_measurement = spec.unit;
  if (spec.deviceClass) payload.device_class = spec.deviceClass;
  if (spec.stateClass) payload.state_class = spec.stateClass;
  if (!spec.primary) {
    payload.entity_category = 'diagnostic';
    if (!cfg.enableAllEntities) payload.enabled_by_default = false;
  }
  return {
    topic: `${cfg.discoveryPrefix}/sensor/ecoflow_${devSlug}/${entitySlug}/config`,
    payload,
  };
}

module.exports = { describeEntity, scaleValue, buildDiscovery, prettyName, slug, shortHash, tokens };
