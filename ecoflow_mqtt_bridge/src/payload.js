'use strict';
const { flatten } = require('./flatten');

/**
 * Parst eine EcoFlow-"quota"-Nachricht. Die Nutzdaten stehen je nach Gerät in
 * `params`, `param`, `data.quotaMap` oder `data`. Gibt ein flaches Objekt zurück oder null.
 */
function parseQuota(buffer) {
  let msg;
  try {
    msg = JSON.parse(buffer.toString('utf8'));
  } catch {
    return null;
  }
  if (!msg || typeof msg !== 'object') return null;
  const body = [msg.params, msg.param, msg.data?.quotaMap, msg.data].find((b) => b && typeof b === 'object');
  if (!body) return null;
  const flat = flatten(body);
  return Object.keys(flat).length ? flat : null;
}

/** Parst eine "status"-Nachricht. true/false = online/offline, null = unbekanntes Format. */
function parseStatus(buffer) {
  try {
    const msg = JSON.parse(buffer.toString('utf8'));
    const s = msg?.params?.status ?? msg?.status ?? msg?.data?.online;
    if (s === undefined || s === null) return null;
    return Number(s) === 1;
  } catch {
    return null;
  }
}

module.exports = { parseQuota, parseStatus };
