'use strict';
/**
 * Flacht verschachtelte JSON-Strukturen zu "a.b.0.c"-Schlüsseln ab.
 * null/undefined sowie leere Objekte/Arrays werden übersprungen.
 */
function flatten(value, prefix = '', out = Object.create(null)) {
  if (value === null || value === undefined) return out;
  if (Array.isArray(value)) {
    value.forEach((v, i) => flatten(v, prefix ? `${prefix}.${i}` : String(i), out));
    return out;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
    return out;
  }
  if (prefix) out[prefix] = value;
  return out;
}

module.exports = { flatten };
