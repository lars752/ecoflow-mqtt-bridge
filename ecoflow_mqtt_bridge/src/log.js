'use strict';
/**
 * Zentrales Logging mit Log-Levels und automatischer Schwärzung von Geheimnissen
 * (Access-/Secret-Key, Passwörter), damit sie nie im Add-on-Log landen.
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
let threshold = LEVELS.info;
const secrets = new Set();

function setLevel(level) {
  threshold = LEVELS[level] ?? LEVELS.info;
}

function addSecret(value) {
  if (value && String(value).length >= 4) secrets.add(String(value));
}

function redact(text) {
  let out = text;
  for (const s of secrets) out = out.split(s).join('***');
  return out;
}

function fmt(v) {
  if (v instanceof Error) return threshold <= LEVELS.debug && v.stack ? v.stack : v.message;
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function emit(level, sink, args) {
  if (LEVELS[level] < threshold) return;
  sink(redact(`${new Date().toISOString()} [${level.toUpperCase()}] ${args.map(fmt).join(' ')}`));
}

const logger = {
  debug: (...a) => emit('debug', console.log, a),
  info: (...a) => emit('info', console.log, a),
  warn: (...a) => emit('warn', console.warn, a),
  error: (...a) => emit('error', console.error, a),
};

module.exports = { logger, setLevel, addSecret, redact };
