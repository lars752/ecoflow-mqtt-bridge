'use strict';
/**
 * Client für die offizielle EcoFlow IoT Open Platform (Developer API).
 * Authentifizierung per Access-/Secret-Key mit HMAC-SHA256-Signatur.
 */
const crypto = require('node:crypto');

class EcoFlowApiError extends Error {
  constructor(message, { code, status } = {}) {
    super(message);
    this.name = 'EcoFlowApiError';
    this.code = code;
    this.status = status;
  }
}

/**
 * Signatur laut EcoFlow-Doku: Query-Parameter alphabetisch sortieren, mit
 * accessKey, nonce und timestamp verketten und mit dem Secret Key HMAC-SHA256 (hex) bilden.
 */
function buildSignature({ params = {}, accessKey, secretKey, nonce, timestamp }) {
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`);
  sorted.push(`accessKey=${accessKey}`, `nonce=${nonce}`, `timestamp=${timestamp}`);
  return crypto.createHmac('sha256', secretKey).update(sorted.join('&')).digest('hex');
}

class EcoFlowApi {
  constructor({ accessKey, secretKey, host, baseUrl, fetchImpl = fetch, timeoutMs = 15000 }) {
    this.accessKey = accessKey;
    this.secretKey = secretKey;
    this.baseUrl = baseUrl || `https://${host}`;
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.supportsRest = true;
    this.mqttScheme = 'open';
  }

  async get(path, params = {}) {
    const nonce = String(crypto.randomInt(100000, 999999));
    const timestamp = String(Date.now());
    const sign = buildSignature({ params, accessKey: this.accessKey, secretKey: this.secretKey, nonce, timestamp });
    const qs = new URLSearchParams(params).toString();
    const url = `${this.baseUrl}${path}${qs ? `?${qs}` : ''}`;

    let res;
    try {
      res = await this.fetch(url, {
        headers: { accessKey: this.accessKey, nonce, timestamp, sign },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new EcoFlowApiError(`Netzwerkfehler bei ${path}: ${err.message}`);
    }
    if (!res.ok) throw new EcoFlowApiError(`HTTP ${res.status} bei ${path}`, { status: res.status });

    let body;
    try {
      body = await res.json();
    } catch {
      throw new EcoFlowApiError(`Antwort von ${path} ist kein JSON`, { status: res.status });
    }
    if (String(body.code) !== '0') {
      throw new EcoFlowApiError(`API-Fehler bei ${path}: ${body.message ?? 'unbekannt'} (Code ${body.code})`, {
        code: String(body.code),
      });
    }
    return body.data;
  }

  /** Alle Geräte des Kontos: [{ sn, name, online }] */
  async listDevices() {
    const data = await this.get('/iot-open/sign/device/list');
    return (Array.isArray(data) ? data : []).map((d) => ({
      sn: String(d.sn),
      name: d.deviceName || String(d.sn),
      online: Number(d.online) === 1,
    }));
  }

  /** Alle Datenpunkte eines Geräts (flaches Objekt mit "modul.feld"-Schlüsseln). */
  async getQuota(sn) {
    const data = await this.get('/iot-open/sign/device/quota/all', { sn });
    return data && typeof data === 'object' ? data : {};
  }

  /** Zugangsdaten für den EcoFlow-Cloud-MQTT-Broker. */
  async getMqttCredentials() {
    const d = await this.get('/iot-open/sign/certification');
    if (!d?.certificateAccount || !d?.certificatePassword || !d?.url) {
      throw new EcoFlowApiError('Unvollständige MQTT-Zugangsdaten von der EcoFlow-API');
    }
    return {
      account: d.certificateAccount,
      password: d.certificatePassword,
      url: d.url,
      port: Number(d.port) || 8883,
      protocol: d.protocol || 'mqtts',
    };
  }
}

module.exports = { EcoFlowApi, EcoFlowApiError, buildSignature };
