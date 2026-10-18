#!/usr/bin/env node
'use strict';
/**
 * Entwickler-Werkzeug (läuft nicht im Add-on): erzeugt src/devices/*.json aus den Wörterbüchern des
 * ioBroker-Adapters ioBroker.ecoflow-mqtt (MIT, (c) foxthefox) – Protobuf-Definitionen,
 * Nachrichtenzuordnung (cmdFunc/cmdId) sowie Einheit, Skalierung und Namen der Datenpunkte.
 *
 *   npm pack iobroker.ecoflow-mqtt && tar xzf iobroker.ecoflow-mqtt-*.tgz
 *   (cd package && npm i --no-save protobufjs)
 *   node scripts/extract-adapter-data.js ./package
 */
const fs = require('node:fs');
const path = require('node:path');

const adapterDir = path.resolve(process.argv[2] || './package');
const outDir = path.join(__dirname, '..', 'src', 'devices');
const dictDir = path.join(adapterDir, 'lib', 'dict_data');
const SKIP = new Set(['unknown', 'unknownjson']);

fs.mkdirSync(outDir, { recursive: true });
for (const f of fs.readdirSync(outDir)) fs.unlinkSync(path.join(outDir, f));

// Header-Proto (HeaderMessage) steht als erste Template-Konstante in ecoflow_utils.js
const utils = fs.readFileSync(path.join(adapterDir, 'lib', 'ecoflow_utils.js'), 'utf8');
const hm = utils.match(/const protoSource = `([\s\S]*?)`;/);
if (!hm) throw new Error('HeaderMessage-Proto nicht gefunden');
fs.writeFileSync(path.join(outDir, 'header.proto'), hm[1].trim() + '\n');

const compact = (o) => {
  const out = {};
  if (o.name) out.name = o.name;
  if (o.unit_of_measurement) out.unit = o.unit_of_measurement;
  if (typeof o.mult === 'number' && o.mult !== 1) out.mult = o.mult;
  if (o.device_class) out.device_class = o.device_class;
  if (o.entity_category) out.category = o.entity_category;
  return out;
};

const index = { types: {}, aliases: { pstream600: 'pstream', pstream800: 'pstream', powerkitbp2000: 'powerkit', powerkitbp5000: 'powerkit' } };
let total = 0;
for (const file of fs.readdirSync(dictDir).sort()) {
  const m = file.match(/^ef_(.+)_data\.js$/);
  if (!m || SKIP.has(m[1])) continue;
  const type = m[1];
  const mod = require(path.join(dictDir, file));
  const kind = mod.protoSource && mod.protoMsg ? 'proto' : 'json';

  const meta = {};
  for (const [channel, byEntity] of Object.entries(mod.deviceStates || {})) {
    for (const [entity, states] of Object.entries(byEntity || {})) {
      if (!['number', 'sensor', 'level', 'diagnostic'].includes(entity)) continue; // Schalter/Texte sind hier nicht nötig
      for (const [state, def] of Object.entries(states || {})) {
        if (!def || typeof def !== 'object') continue;
        const c = compact(def);
        if (Object.keys(c).length) meta[`${channel}.${state}`] = c;
      }
    }
  }
  const out = { type, kind, meta };
  if (kind === 'proto') {
    out.proto = mod.protoSource;
    out.cmdFunc = mod.protoMsg.cmdFunc;
  }
  fs.writeFileSync(path.join(outDir, `${type}.json`), JSON.stringify(out));
  index.types[type] = kind;
  total += Object.keys(meta).length;
}
fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index, null, 1));
console.log(`${Object.keys(index.types).length} Gerätetypen, ${total} Datenpunkt-Metadaten`);
