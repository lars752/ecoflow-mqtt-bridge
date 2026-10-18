'use strict';
/**
 * Dekodierung der Protobuf-Nachrichten der EcoFlow-App-Schnittstelle (/app/device/property/<SN>).
 * Aufbau: HeaderMessage { Header[] } – je Header ein pdata-Block, der (optional per XOR mit seq
 * verschlüsselt) eine gerätespezifische Nachricht enthält, gewählt über cmdFunc/cmdId.
 */
const { getHeaderRoot, loadType } = require('./catalog');
const { flatten } = require('./flatten');

// Nachrichten ohne Messwerte (Energie-Zeitreihen, Konfiguration) – wie im ioBroker-Adapter ignoriert
const SKIP_MESSAGES = new Set(['EnergyPack', 'PowerPack', 'time_task_config', 'time_task_config_post']);
const MAX_KEYS_PER_MESSAGE = 400;
const MAX_STRING = 255; // Home-Assistant-Sensorzustände sind auf 255 Zeichen begrenzt

const TO_OBJECT = { defaults: false, longs: Number, enums: Number, bytes: String, arrays: true };

function decryptXor(buf, seq) {
  const key = Number(seq) & 0xff;
  const out = Buffer.allocUnsafe(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = buf[i] ^ key;
  return out;
}

function cleanFlat(flat) {
  for (const [k, v] of Object.entries(flat)) {
    if ((typeof v === 'number' && !Number.isFinite(v)) || (typeof v === 'string' && v.length > MAX_STRING)) delete flat[k];
  }
  return flat;
}

/**
 * Dekodiert eine App-MQTT-Nachricht für den Gerätetyp `type`.
 * Rückgabe: { flat, offline, messages, skipped } – flat = flaches Objekt "nachricht.feld" -> Wert.
 * Wirft bei ungültigem Protobuf (Aufrufer fängt ab).
 */
function decodeProto(type, buffer) {
  const entry = loadType(type);
  if (!entry || entry.kind !== 'proto') throw new Error(`Kein Protobuf-Gerätetyp: ${type}`);

  const headerType = getHeaderRoot().lookupType('HeaderMessage');
  const msg = headerType.toObject(headerType.decode(buffer), TO_OBJECT);
  const flat = Object.create(null);
  const result = { flat, offline: false, messages: [], skipped: [] };

  for (const header of msg.header ?? []) {
    const { cmdFunc, cmdId, seq, encType, src, code } = header;
    if (!cmdFunc) {
      if (String(code) === '-2') result.offline = true;
      continue;
    }
    const name = entry.cmdFunc?.[cmdFunc]?.cmdId?.[cmdId];
    if (!name) {
      result.skipped.push(`cmdFunc ${cmdFunc}/cmdId ${cmdId}`);
      continue;
    }
    if (SKIP_MESSAGES.has(name) || !header.pdata) continue;

    // pdata ist wegen bytes: String base64-kodiert
    let pdata = Buffer.from(header.pdata, 'base64');
    if (Number(encType) === 1 && src !== 32) pdata = decryptXor(pdata, seq);

    let decoded;
    try {
      const T = entry.root.lookupType(name);
      decoded = T.toObject(T.decode(pdata), TO_OBJECT);
    } catch (err) {
      result.skipped.push(`${name}: ${err.message}`);
      continue;
    }
    const part = cleanFlat(flatten(decoded, name));
    const keys = Object.keys(part);
    if (keys.length > MAX_KEYS_PER_MESSAGE) {
      result.skipped.push(`${name}: ${keys.length} Felder (zu viele)`);
      continue;
    }
    Object.assign(flat, part);
    result.messages.push(name);
  }
  return result;
}

module.exports = { decodeProto, decryptXor };
