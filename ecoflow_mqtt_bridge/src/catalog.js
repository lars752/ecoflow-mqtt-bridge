'use strict';
/**
 * Gerätekatalog: Protobuf-Definitionen, Nachrichtenzuordnung und Datenpunkt-Metadaten
 * (Einheit, Skalierung, Name) je EcoFlow-Gerätetyp. Die Daten in src/devices/ stammen aus dem
 * ioBroker-Adapter ioBroker.ecoflow-mqtt (MIT, (c) foxthefox), siehe NOTICE.md.
 */
const fs = require('node:fs');
const path = require('node:path');
const protobuf = require('protobufjs');

const DIR = path.join(__dirname, 'devices');
const index = JSON.parse(fs.readFileSync(path.join(DIR, 'index.json'), 'utf8'));
const cache = new Map();
let headerRoot = null;

/** Alle wählbaren Gerätetypen inkl. Aliasse (pstream600, powerkitbp2000, ...). */
function listTypes() {
  return [...Object.keys(index.types), ...Object.keys(index.aliases)].sort();
}

/** Löst Aliasse auf; gibt null für unbekannte Typen zurück. */
function resolveType(type) {
  if (!type) return null;
  const t = index.aliases[type] ?? type;
  return index.types[t] ? t : null;
}

function loadType(type) {
  const t = resolveType(type);
  if (!t) return null;
  if (cache.has(t)) return cache.get(t);
  const raw = JSON.parse(fs.readFileSync(path.join(DIR, `${t}.json`), 'utf8'));
  const entry = { type: t, kind: raw.kind, meta: raw.meta, cmdFunc: raw.cmdFunc ?? null, root: null, byField: null };
  if (raw.kind === 'proto') entry.root = protobuf.parse(raw.proto, { keepCase: false }).root;
  cache.set(t, entry);
  return entry;
}

function getHeaderRoot() {
  if (!headerRoot) {
    headerRoot = protobuf.parse(fs.readFileSync(path.join(DIR, 'header.proto'), 'utf8'), { keepCase: false }).root;
  }
  return headerRoot;
}

const ALIAS_PREFIX = { bms_bmsStatus: 'bmsMaster', bms_emsStatus: 'ems' };

/**
 * Metadaten (name, unit, mult, device_class, category) zu einem Datenpunkt-Schlüssel.
 * Reihenfolge: exakter Schlüssel (Array-Indizes ignoriert), bekannte Präfix-Aliasse, danach der
 * Feldname allein, sofern er im Gerätetyp eindeutig ist (Developer-API liefert z. B. "invOutputWatts").
 */
function lookupMeta(type, key) {
  const entry = loadType(type);
  if (!entry) return undefined;
  const clean = key.split('.').filter((s) => !/^\d+$/.test(s));
  const exact = clean.join('.');
  if (entry.meta[exact]) return entry.meta[exact];
  if (clean.length > 1 && ALIAS_PREFIX[clean[0]]) {
    const aliased = [ALIAS_PREFIX[clean[0]], ...clean.slice(1)].join('.');
    if (entry.meta[aliased]) return entry.meta[aliased];
  }
  if (!entry.byField) {
    entry.byField = new Map();
    for (const [k, v] of Object.entries(entry.meta)) {
      const field = k.slice(k.indexOf('.') + 1);
      entry.byField.set(field, entry.byField.has(field) ? null : v); // null = mehrdeutig
    }
  }
  return entry.byField.get(clean[clean.length - 1]) ?? undefined;
}

module.exports = { listTypes, resolveType, loadType, getHeaderRoot, lookupMeta };
